"""Genuine peer-to-peer messaging between agents.

The blackboard is *shared state*: every agent reads and writes the same keyed
records, and the latest value wins. P2P is a *mailbox*: a message is addressed
to exactly one recipient, is delivered exactly once, and is correlated to a
task through ``correlation_id``. The two paths are intentionally independent:

* blackboard records live in ``blackboard.db`` and are never consumed;
* P2P messages live in ``p2p_mailbox.db`` and are acknowledged on delivery.

Delivery is real: rows are persisted, recipients must be registered peers, and
``receive`` claims messages inside a ``BEGIN IMMEDIATE`` transaction so a
message can never be handed to two concurrent consumers (in one process or
across processes sharing the same file).

No method fabricates a message, a peer, or a delivery. Invalid input raises
``P2PError`` subclasses instead of being silently dropped.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from pydantic import ValidationError

from mas.models.schemas import (
    P2P_AGENT_ID_PATTERN,
    P2P_MESSAGE_TYPES,
    P2P_TOKEN_PATTERN,
    P2PMessage,
)

logger = logging.getLogger(__name__)

#: SQLite rejects/ignores locks after this long instead of hanging forever.
BUSY_TIMEOUT_MS = 5_000


class P2PError(RuntimeError):
    """Base class for every P2P failure."""


class MalformedMessageError(P2PError, ValueError):
    """The message envelope failed schema validation."""


class UnknownPeerError(P2PError, LookupError):
    """The sender or recipient is not a registered peer."""


class UnknownRecipientError(UnknownPeerError):
    """The addressed mailbox does not exist."""


class UnknownSenderError(UnknownPeerError):
    """The sending agent is not a registered peer."""


class DuplicateMessageError(P2PError):
    """A message with the same ``msg_id`` was already delivered."""


class DeliveryFailureError(P2PError):
    """The mailbox could not persist or claim a message."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat()


def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value)


class P2PMailbox:
    """File-backed addressed mailbox with exactly-once delivery."""

    def __init__(self, db_path: str | Path, auto_register: Iterable[str] = ()):
        self.db_path = str(db_path)
        self._lock = threading.RLock()
        self._init_db()
        for agent_id in auto_register:
            self.register_peer(agent_id)
        logger.info("[P2P] Mailbox ready at %s", self.db_path)

    # ── storage ──────────────────────────────────────────────────────────────

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
        return conn

    def _init_db(self) -> None:
        parent = Path(self.db_path).parent
        parent.mkdir(parents=True, exist_ok=True)
        try:
            with self._lock:
                conn = self._connect()
                try:
                    conn.executescript(
                        """
                        PRAGMA journal_mode = WAL;

                        CREATE TABLE IF NOT EXISTS p2p_peers (
                            agent_id TEXT PRIMARY KEY,
                            registered_at TEXT NOT NULL
                        );

                        CREATE TABLE IF NOT EXISTS p2p_messages (
                            seq INTEGER PRIMARY KEY AUTOINCREMENT,
                            msg_id TEXT UNIQUE NOT NULL,
                            correlation_id TEXT NOT NULL,
                            sender TEXT NOT NULL,
                            recipient TEXT NOT NULL,
                            msg_type TEXT NOT NULL,
                            content TEXT NOT NULL,
                            created_at TEXT NOT NULL,
                            delivered_at TEXT,
                            acknowledged INTEGER NOT NULL DEFAULT 0,
                            expires_at TEXT
                        );

                        CREATE TABLE IF NOT EXISTS p2p_dead_letters (
                            msg_id TEXT PRIMARY KEY,
                            correlation_id TEXT NOT NULL,
                            sender TEXT NOT NULL,
                            recipient TEXT NOT NULL,
                            msg_type TEXT NOT NULL,
                            content TEXT NOT NULL,
                            created_at TEXT NOT NULL,
                            reason TEXT NOT NULL,
                            dead_lettered_at TEXT NOT NULL
                        );

                        CREATE INDEX IF NOT EXISTS idx_p2p_recipient_pending
                            ON p2p_messages(recipient, acknowledged, seq);
                        CREATE INDEX IF NOT EXISTS idx_p2p_correlation
                            ON p2p_messages(correlation_id);
                        """
                    )
                    # Forward migration for mailboxes created before TTL support.
                    columns = {
                        row["name"]
                        for row in conn.execute("PRAGMA table_info(p2p_messages)")
                    }
                    if "expires_at" not in columns:
                        conn.execute(
                            "ALTER TABLE p2p_messages ADD COLUMN expires_at TEXT"
                        )
                    # The index needs the column, so it must be created after the
                    # ALTER above, never inside the initial script.
                    conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_p2p_expiry "
                        "ON p2p_messages(expires_at)"
                    )
                    conn.commit()
                finally:
                    conn.close()
        except (sqlite3.Error, OSError) as error:
            raise DeliveryFailureError(
                f"Cannot initialise P2P mailbox at {self.db_path}: {error}"
            ) from error

    # ── peer registry ────────────────────────────────────────────────────────

    @staticmethod
    def _validate_agent_id(agent_id: Any, field_name: str = "agent_id") -> str:
        if not isinstance(agent_id, str) or not P2P_AGENT_ID_PATTERN.match(agent_id):
            raise MalformedMessageError(
                f"{field_name} must be a lower-case snake_case identifier, "
                f"got {agent_id!r}."
            )
        return agent_id

    def register_peer(self, agent_id: str) -> str:
        """Register a mailbox owner. Idempotent."""
        self._validate_agent_id(agent_id)
        try:
            with self._lock:
                conn = self._connect()
                try:
                    conn.execute(
                        "INSERT OR IGNORE INTO p2p_peers (agent_id, registered_at) "
                        "VALUES (?, ?)",
                        (agent_id, _isoformat(_utc_now())),
                    )
                    conn.commit()
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(
                f"Could not register peer {agent_id!r}: {error}"
            ) from error
        return agent_id

    def unregister_peer(self, agent_id: str) -> bool:
        self._validate_agent_id(agent_id)
        try:
            with self._lock:
                conn = self._connect()
                try:
                    cursor = conn.execute(
                        "DELETE FROM p2p_peers WHERE agent_id = ?", (agent_id,)
                    )
                    conn.commit()
                    return cursor.rowcount > 0
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(
                f"Could not unregister peer {agent_id!r}: {error}"
            ) from error

    def is_registered(self, agent_id: str) -> bool:
        self._validate_agent_id(agent_id)
        try:
            with self._lock:
                conn = self._connect()
                try:
                    row = conn.execute(
                        "SELECT 1 FROM p2p_peers WHERE agent_id = ?", (agent_id,)
                    ).fetchone()
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(
                f"Could not read peer registry: {error}"
            ) from error
        return row is not None

    def list_peers(self) -> List[str]:
        try:
            with self._lock:
                conn = self._connect()
                try:
                    rows = conn.execute(
                        "SELECT agent_id FROM p2p_peers ORDER BY agent_id"
                    ).fetchall()
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(f"Could not list peers: {error}") from error
        return [row["agent_id"] for row in rows]

    # ── send ─────────────────────────────────────────────────────────────────

    def send(
        self,
        sender: str,
        recipient: str,
        content: Any,
        msg_type: str = "data",
        correlation_id: Optional[str] = None,
        msg_id: Optional[str] = None,
        ttl_seconds: Optional[float] = None,
    ) -> P2PMessage:
        """Deliver a message to ``recipient``'s mailbox.

        ``ttl_seconds`` sets an expiry: an undelivered message older than the
        TTL is moved to the dead-letter table and is never handed to a consumer.
        ``None`` (the default) means the message never expires.

        Raises:
            MalformedMessageError: invalid ids/type/content envelope or TTL.
            UnknownSenderError: sender is not a registered peer.
            UnknownRecipientError: recipient has no mailbox.
            DuplicateMessageError: ``msg_id`` was already used.
            DeliveryFailureError: the mailbox could not be written.
        """
        if ttl_seconds is not None:
            if isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, (int, float)):
                raise MalformedMessageError("ttl_seconds must be a number or None.")
            if ttl_seconds <= 0:
                raise MalformedMessageError("ttl_seconds must be > 0.")

        try:
            message = P2PMessage(
                msg_id=msg_id or str(uuid.uuid4()),
                correlation_id=correlation_id or str(uuid.uuid4()),
                sender=sender,
                recipient=recipient,
                content=content,
                msg_type=msg_type,
            )
        except ValidationError as error:
            raise MalformedMessageError(
                f"Invalid P2P message: {error.errors()[0]['msg']}"
                if error.errors()
                else f"Invalid P2P message: {error}"
            ) from error

        expires_at = (
            None
            if ttl_seconds is None
            else _isoformat(message.created_at + timedelta(seconds=ttl_seconds))
        )

        if not self.is_registered(message.sender):
            raise UnknownSenderError(
                f"Sender {message.sender!r} is not a registered peer."
            )
        if not self.is_registered(message.recipient):
            raise UnknownRecipientError(
                f"Recipient {message.recipient!r} is not a registered peer."
            )

        payload = message.model_dump_json()
        try:
            with self._lock:
                conn = self._connect()
                try:
                    conn.execute(
                        """INSERT INTO p2p_messages
                        (msg_id, correlation_id, sender, recipient, msg_type,
                         content, created_at, acknowledged, expires_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)""",
                        (
                            message.msg_id,
                            message.correlation_id,
                            message.sender,
                            message.recipient,
                            message.msg_type,
                            payload,
                            _isoformat(message.created_at),
                            expires_at,
                        ),
                    )
                    conn.commit()
                finally:
                    conn.close()
        except sqlite3.IntegrityError as error:
            raise DuplicateMessageError(
                f"Message {message.msg_id!r} was already delivered."
            ) from error
        except sqlite3.Error as error:
            raise DeliveryFailureError(
                f"Could not deliver message {message.msg_id!r}: {error}"
            ) from error

        logger.debug(
            "[P2P] delivered %s %s -> %s (%s)",
            message.msg_id[:8],
            message.sender,
            message.recipient,
            message.msg_type,
        )
        return message

    # ── receive ──────────────────────────────────────────────────────────────

    def _claim(
        self,
        recipient: str,
        msg_type: Optional[str],
        correlation_id: Optional[str],
        limit: Optional[int],
        acknowledge: bool,
    ) -> List[P2PMessage]:
        self._validate_agent_id(recipient, "recipient")
        if msg_type is not None and msg_type not in P2P_MESSAGE_TYPES:
            raise MalformedMessageError(f"Unknown msg_type {msg_type!r}.")
        if limit is not None and (not isinstance(limit, int) or limit < 1):
            raise MalformedMessageError("limit must be a positive integer.")

        clauses = ["recipient = ?", "acknowledged = 0"]
        params: List[Any] = [recipient]
        # Expired messages are never delivered, even before they are swept.
        clauses.append("(expires_at IS NULL OR expires_at > ?)")
        params.append(_isoformat(_utc_now()))
        if msg_type:
            clauses.append("msg_type = ?")
            params.append(msg_type)
        if correlation_id:
            if not isinstance(correlation_id, str) or not P2P_TOKEN_PATTERN.match(
                correlation_id
            ):
                raise MalformedMessageError(
                    f"Invalid correlation_id {correlation_id!r}."
                )
            clauses.append("correlation_id = ?")
            params.append(correlation_id)

        where = " AND ".join(clauses)
        query = f"SELECT * FROM p2p_messages WHERE {where} ORDER BY seq"
        if limit is not None:
            query += " LIMIT ?"
            params.append(limit)

        try:
            with self._lock:
                conn = self._connect()
                try:
                    if acknowledge:
                        # Claim under a write lock so two consumers cannot both
                        # see the same unacknowledged row.
                        conn.execute("BEGIN IMMEDIATE")
                    rows = conn.execute(query, params).fetchall()
                    delivered_at = _isoformat(_utc_now())
                    if acknowledge and rows:
                        conn.executemany(
                            "UPDATE p2p_messages SET acknowledged = 1, "
                            "delivered_at = ? WHERE msg_id = ? AND acknowledged = 0",
                            [(delivered_at, row["msg_id"]) for row in rows],
                        )
                    if acknowledge:
                        conn.commit()
                except sqlite3.Error:
                    if acknowledge:
                        conn.rollback()
                    raise
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(
                f"Could not read mailbox for {recipient!r}: {error}"
            ) from error

        messages: List[P2PMessage] = []
        for row in rows:
            envelope = P2PMessage.model_validate_json(row["content"])
            messages.append(
                envelope.model_copy(
                    update={
                        "acknowledged": acknowledge,
                        "delivered_at": (
                            _parse_timestamp(delivered_at) if acknowledge else None
                        ),
                    }
                )
            )
        logger.debug(
            "[P2P] %s %d message(s) for %s",
            "claimed" if acknowledge else "peeked",
            len(messages),
            recipient,
        )
        return messages

    def receive(
        self,
        recipient: str,
        msg_type: Optional[str] = None,
        correlation_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[P2PMessage]:
        """Claim and acknowledge pending messages for ``recipient``.

        Each message is returned at most once: delivery is recorded in the same
        transaction that reads it. Expired messages are dead-lettered first and
        are never returned.
        """
        self.sweep_expired(recipient)
        return self._claim(
            recipient,
            msg_type=msg_type,
            correlation_id=correlation_id,
            limit=limit,
            acknowledge=True,
        )

    def peek(
        self,
        recipient: str,
        msg_type: Optional[str] = None,
        correlation_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[P2PMessage]:
        """Inspect pending messages without acknowledging them."""
        return self._claim(
            recipient,
            msg_type=msg_type,
            correlation_id=correlation_id,
            limit=limit,
            acknowledge=False,
        )

    def acknowledge(self, msg_id: str, recipient: str) -> bool:
        """Acknowledge a specific pending message. Returns False if not found."""
        self._validate_agent_id(recipient, "recipient")
        if not isinstance(msg_id, str) or not msg_id:
            raise MalformedMessageError("msg_id must be a non-empty string.")
        try:
            with self._lock:
                conn = self._connect()
                try:
                    cursor = conn.execute(
                        "UPDATE p2p_messages SET acknowledged = 1, delivered_at = ? "
                        "WHERE msg_id = ? AND recipient = ? AND acknowledged = 0",
                        (_isoformat(_utc_now()), msg_id, recipient),
                    )
                    conn.commit()
                    return cursor.rowcount > 0
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(
                f"Could not acknowledge message {msg_id!r}: {error}"
            ) from error

    def sweep_expired(self, recipient: Optional[str] = None) -> int:
        """Move expired, still-undelivered messages to the dead-letter table.

        Returns the number of messages dead-lettered. Safe to call at any time;
        idempotent because moved rows leave ``p2p_messages``.
        """
        if recipient is not None:
            self._validate_agent_id(recipient, "recipient")
        now = _isoformat(_utc_now())
        where = "acknowledged = 0 AND expires_at IS NOT NULL AND expires_at <= ?"
        params: List[Any] = [now]
        if recipient is not None:
            where += " AND recipient = ?"
            params.append(recipient)

        try:
            with self._lock:
                conn = self._connect()
                try:
                    conn.execute("BEGIN IMMEDIATE")
                    rows = conn.execute(
                        f"SELECT * FROM p2p_messages WHERE {where}", params
                    ).fetchall()
                    if rows:
                        stamp = _isoformat(_utc_now())
                        conn.executemany(
                            """INSERT OR REPLACE INTO p2p_dead_letters
                            (msg_id, correlation_id, sender, recipient, msg_type,
                             content, created_at, reason, dead_lettered_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            [
                                (
                                    row["msg_id"],
                                    row["correlation_id"],
                                    row["sender"],
                                    row["recipient"],
                                    row["msg_type"],
                                    row["content"],
                                    row["created_at"],
                                    "expired",
                                    stamp,
                                )
                                for row in rows
                            ],
                        )
                        conn.executemany(
                            "DELETE FROM p2p_messages WHERE msg_id = ?",
                            [(row["msg_id"],) for row in rows],
                        )
                    conn.commit()
                except sqlite3.Error:
                    conn.rollback()
                    raise
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(
                f"Could not sweep expired messages: {error}"
            ) from error

        if rows:
            logger.warning("[P2P] dead-lettered %d expired message(s)", len(rows))
        return len(rows)

    def dead_letters(self, recipient: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return dead-lettered messages (oldest first) for inspection."""
        query = "SELECT * FROM p2p_dead_letters"
        params: List[Any] = []
        if recipient is not None:
            self._validate_agent_id(recipient, "recipient")
            query += " WHERE recipient = ?"
            params.append(recipient)
        query += " ORDER BY dead_lettered_at, msg_id"
        try:
            with self._lock:
                conn = self._connect()
                try:
                    rows = conn.execute(query, params).fetchall()
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(
                f"Could not read dead letters: {error}"
            ) from error
        return [dict(row) for row in rows]

    def pending_count(self, recipient: Optional[str] = None) -> int:
        query = (
            "SELECT COUNT(*) AS n FROM p2p_messages "
            "WHERE acknowledged = 0 AND (expires_at IS NULL OR expires_at > ?)"
        )
        params: List[Any] = [_isoformat(_utc_now())]
        if recipient is not None:
            self._validate_agent_id(recipient, "recipient")
            query += " AND recipient = ?"
            params.append(recipient)
        try:
            with self._lock:
                conn = self._connect()
                try:
                    row = conn.execute(query, params).fetchone()
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(f"Could not count pending: {error}") from error
        return int(row["n"])

    def stats(self) -> Dict[str, int]:
        """Delivery counters derived from the mailbox itself (not counters)."""
        now = _isoformat(_utc_now())
        try:
            with self._lock:
                conn = self._connect()
                try:
                    sent = conn.execute(
                        "SELECT COUNT(*) AS n FROM p2p_messages"
                    ).fetchone()["n"]
                    delivered = conn.execute(
                        "SELECT COUNT(*) AS n FROM p2p_messages WHERE acknowledged = 1"
                    ).fetchone()["n"]
                    expired = conn.execute(
                        "SELECT COUNT(*) AS n FROM p2p_messages "
                        "WHERE acknowledged = 0 AND expires_at IS NOT NULL "
                        "AND expires_at <= ?",
                        (now,),
                    ).fetchone()["n"]
                    dead_letters = conn.execute(
                        "SELECT COUNT(*) AS n FROM p2p_dead_letters"
                    ).fetchone()["n"]
                    peers = conn.execute(
                        "SELECT COUNT(*) AS n FROM p2p_peers"
                    ).fetchone()["n"]
                finally:
                    conn.close()
        except sqlite3.Error as error:
            raise DeliveryFailureError(f"Could not read P2P stats: {error}") from error
        return {
            "sent": int(sent),
            "delivered": int(delivered),
            "pending": int(sent) - int(delivered) - int(expired),
            "expired": int(expired),
            "dead_letters": int(dead_letters),
            "peers": int(peers),
        }


# ── process-wide mailbox ────────────────────────────────────────────────────

_mailbox: Optional[P2PMailbox] = None
_mailbox_path: Optional[str] = None


def get_mailbox(db_path: Optional[str] = None) -> P2PMailbox:
    """Return the process-wide mailbox, creating it on first use."""
    global _mailbox, _mailbox_path
    if db_path is None:
        from mas.config import config

        db_path = config.P2P_DB
    if _mailbox is None or _mailbox_path != db_path:
        _mailbox = P2PMailbox(db_path)
        _mailbox_path = db_path
    return _mailbox


def reset_mailbox() -> None:
    """Drop the cached mailbox (used by tests)."""
    global _mailbox, _mailbox_path
    _mailbox = None
    _mailbox_path = None
