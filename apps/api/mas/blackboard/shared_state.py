"""
Blackboard Architecture (Requirement #1 - MANDATORY).

The Blackboard is the central shared data structure that ALL agents use
to read/write intermediate results. This enables loose coupling between
the CrewAI agents and the ADK agents — they never talk directly, but
coordinate through this shared state.

Peer-to-peer messaging is a *different* communication path and is provided by
:class:`mas.messaging.p2p.P2PMailbox` (addressed, consumed exactly once, stored
in its own database). ``Blackboard.p2p_*`` are thin delegations kept for
backwards compatibility; they do not write to the blackboard tables.
"""
from __future__ import annotations
import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import logging

from mas.messaging.p2p import P2PMailbox

logger = logging.getLogger(__name__)


class Blackboard:
    """
    Thread-safe SQLite-backed shared state store.
    
    Architecture: Blackboard pattern — agents write results here,
    other agents read from here. No direct agent-to-agent calls for
    data sharing (use A2A/P2P for that instead).
    """

    def __init__(self, db_path: str, p2p_db_path: Optional[str] = None):
        self.db_path = db_path
        self._lock = threading.RLock()
        self._subscribers: Dict[str, List[Callable]] = {}
        self._stats = {"reads": 0, "writes": 0}
        # P2P lives in its own database file: a separate transport with
        # addressed, consumed messages rather than shared keyed state.
        self.mailbox = P2PMailbox(
            p2p_db_path or str(Path(db_path).with_name("p2p_mailbox.db"))
        )
        self._init_db()
        logger.info(f"Blackboard initialized at {db_path}")

    def _init_db(self):
        with self._connection() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS blackboard (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    agent_name TEXT NOT NULL,
                    version INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_blackboard_runid_key
                    ON blackboard(run_id, key);

                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    agent_name TEXT NOT NULL,
                    details TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    @contextmanager
    def _connection(self) -> Any:
        """Yield a connection that is always committed/rolled back and closed.

        ``with sqlite3.connect(...)`` commits but does **not** close, which
        leaks file handles (and blocks cleanup on Windows).
        """
        conn = self._get_conn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ── BLACKBOARD OPERATIONS ────────────────────────────────────────────────

    def write(self, key: str, value: Any, agent_name: str, run_id: str) -> None:
        """Write a value to the blackboard. Triggers any subscribed callbacks."""
        with self._lock:
            serialized = json.dumps(value, default=str)
            with self._connection() as conn:
                existing = conn.execute(
                    "SELECT id, version FROM blackboard WHERE run_id=? AND key=?",
                    (run_id, key)
                ).fetchone()
                if existing:
                    conn.execute(
                        """UPDATE blackboard SET value=?, agent_name=?, version=version+1,
                        updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND key=?""",
                        (serialized, agent_name, run_id, key)
                    )
                else:
                    conn.execute(
                        """INSERT INTO blackboard (run_id, key, value, agent_name)
                        VALUES (?, ?, ?, ?)""",
                        (run_id, key, serialized, agent_name)
                    )
                conn.execute(
                    "INSERT INTO audit_log (run_id, event_type, agent_name, details) VALUES (?,?,?,?)",
                    (run_id, "blackboard_write", agent_name, json.dumps({"key": key}))
                )
            self._stats["writes"] += 1
            logger.debug(f"[Blackboard] WRITE key={key} agent={agent_name} run={run_id}")
            # Notify subscribers
            for callback in self._subscribers.get(key, []):
                try:
                    callback(key, value, agent_name, run_id)
                except Exception as e:
                    logger.error(f"Subscriber callback error: {e}")

    def read(self, key: str, run_id: str) -> Optional[Any]:
        """Read the latest value for a key from the blackboard."""
        with self._lock:
            with self._connection() as conn:
                row = conn.execute(
                    """SELECT value FROM blackboard WHERE run_id=? AND key=?
                    ORDER BY version DESC LIMIT 1""",
                    (run_id, key)
                ).fetchone()
            self._stats["reads"] += 1
            if row:
                return json.loads(row["value"])
            return None

    def read_all(self, run_id: str) -> Dict[str, Any]:
        """Read all key-value pairs for a run."""
        with self._lock:
            with self._connection() as conn:
                rows = conn.execute(
                    """SELECT key, value FROM blackboard WHERE run_id=?
                    GROUP BY key HAVING MAX(version)""",
                    (run_id,)
                ).fetchall()
            return {row["key"]: json.loads(row["value"]) for row in rows}

    def get_history(self, run_id: str, key: Optional[str] = None) -> List[Dict]:
        """Get full write history for auditing/provenance."""
        with self._lock:
            with self._connection() as conn:
                if key:
                    rows = conn.execute(
                        """SELECT key, value, agent_name, version, created_at
                        FROM blackboard WHERE run_id=? AND key=? ORDER BY version""",
                        (run_id, key)
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """SELECT key, value, agent_name, version, created_at
                        FROM blackboard WHERE run_id=? ORDER BY created_at""",
                        (run_id,)
                    ).fetchall()
            return [{"key": r["key"], "value": json.loads(r["value"]),
                     "agent": r["agent_name"], "version": r["version"],
                     "at": r["created_at"]} for r in rows]

    def subscribe(self, key: str, callback: Callable) -> None:
        """Subscribe to writes on a specific key."""
        if key not in self._subscribers:
            self._subscribers[key] = []
        self._subscribers[key].append(callback)
        logger.debug(f"[Blackboard] Subscribed to key={key}")

    # ── PEER-TO-PEER MESSAGING (delegated transport) ─────────────────────────

    def p2p_send(self, sender: str, recipient: str, content: Any,
                 msg_type: str = "data", run_id: str = "",
                 correlation_id: Optional[str] = None,
                 msg_id: Optional[str] = None) -> str:
        """Send an addressed message through the P2P mailbox.

        This is NOT a blackboard write: the message is owned by ``recipient``,
        acknowledged on delivery, and stored in the P2P database.

        Raises ``P2PError`` subclasses for unknown peers, malformed envelopes,
        duplicates, or storage failures. Nothing is silently dropped.
        """
        message = self.mailbox.send(
            sender=sender,
            recipient=recipient,
            content=content,
            msg_type=msg_type,
            correlation_id=correlation_id,
            msg_id=msg_id,
        )
        if run_id:
            with self._lock:
                with self._connection() as conn:
                    conn.execute(
                        "INSERT INTO audit_log (run_id, event_type, agent_name, details) VALUES (?,?,?,?)",
                        (run_id, "p2p_send", sender,
                         json.dumps({"to": recipient, "type": msg_type,
                                     "msg_id": message.msg_id,
                                     "correlation_id": message.correlation_id}))
                    )
        logger.debug(f"[P2P] {sender} -> {recipient} type={msg_type}")
        return message.msg_id

    def p2p_receive(self, recipient: str, msg_type: Optional[str] = None,
                    correlation_id: Optional[str] = None,
                    limit: Optional[int] = None) -> List[Dict]:
        """Claim pending P2P messages for an agent (exactly-once delivery)."""
        messages = self.mailbox.receive(
            recipient,
            msg_type=msg_type,
            correlation_id=correlation_id,
            limit=limit,
        )
        return [
            {
                "msg_id": message.msg_id,
                "correlation_id": message.correlation_id,
                "sender": message.sender,
                "recipient": message.recipient,
                "content": message.content,
                "msg_type": message.msg_type,
                "created_at": message.created_at.isoformat(),
                "delivered_at": (
                    message.delivered_at.isoformat() if message.delivered_at else None
                ),
                "acknowledged": message.acknowledged,
            }
            for message in messages
        ]

    # ── STATS ────────────────────────────────────────────────────────────────

    def get_stats(self) -> Dict[str, int]:
        stats = dict(self._stats)
        p2p = self.mailbox.stats()
        stats["p2p_sends"] = p2p["sent"]
        stats["p2p_reads"] = p2p["delivered"]
        stats["p2p_pending"] = p2p["pending"]
        return stats

    def compare_blackboard_vs_p2p(self, run_id: str) -> Dict:
        """Generate a comparison report of Blackboard vs P2P usage."""
        stats = self.get_stats()
        history = self.get_history(run_id)
        return {
            "architecture_comparison": {
                "blackboard": {
                    "pattern": "Shared State (Publish/Subscribe)",
                    "reads": stats["reads"],
                    "writes": stats["writes"],
                    "entries": len(history),
                    "pros": ["Decoupled agents", "Full audit trail", "Easy to add new agents"],
                    "cons": ["Single point of contention", "Persistence overhead"],
                },
                "p2p": {
                    "pattern": "Direct Peer-to-Peer Messaging",
                    "sends": stats["p2p_sends"],
                    "reads": stats["p2p_reads"],
                    "pending": stats["p2p_pending"],
                    "scope": "mailbox lifetime (counters are not per-run)",
                    "pros": ["Low latency", "No central bottleneck", "Targeted delivery"],
                    "cons": ["Tight coupling", "No shared context", "Recipient must exist"],
                },
                "verdict": "Blackboard preferred for shared context; P2P for addressed task hand-offs"
            }
        }


# Singleton instance (created per run by main)
_blackboard_instance: Optional[Blackboard] = None


def get_blackboard(db_path: Optional[str] = None) -> Blackboard:
    global _blackboard_instance
    if _blackboard_instance is None:
        from mas.config import config
        _blackboard_instance = Blackboard(db_path or config.BLACKBOARD_DB)
    return _blackboard_instance
