"""Enterprise Multi-Tenant Database Layer supporting PostgreSQL with SQLite fallback.

Features:
- Safe connection pooling via psycopg
- Automatic schema migration and indexing
- Strict multi-tenant and user-level data isolation
- Context persistence across restarts
- Durability for Blackboard and P2P audit trails
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

from app.config import settings
from app.schemas import PageContext

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Multi-tenant database engine with PostgreSQL pooling and SQLite fallback."""

    def __init__(self, db_url: str | None = None) -> None:
        self.raw_url = (db_url or settings.database_url).strip()
        self.is_postgres = self.raw_url.startswith("postgresql://") or self.raw_url.startswith("postgres://")
        self._lock = threading.RLock()
        self._pg_pool = None
        self._sqlite_path = Path(__file__).resolve().parent.parent / "mas" / "outputs" / "mindspace_core.db"

        if self.is_postgres:
            self._init_pg_pool()
        else:
            self._sqlite_path.parent.mkdir(parents=True, exist_ok=True)

        self.run_migrations()

    def _init_pg_pool(self) -> None:
        try:
            from psycopg_pool import ConnectionPool

            # Normalize postgres:// to postgresql://
            url = self.raw_url
            if url.startswith("postgres://"):
                url = "postgresql://" + url[len("postgres://") :]

            self._pg_pool = ConnectionPool(
                conninfo=url,
                min_size=2,
                max_size=10,
                timeout=10.0,
                max_idle=300,
                open=True,
            )
            logger.info("Initialized PostgreSQL connection pool successfully.")
        except Exception as e:
            logger.error("Failed to initialize PostgreSQL pool (%s). Falling back to SQLite.", e)
            self.is_postgres = False

    @contextmanager
    def connection(self) -> Generator[Any, None, None]:
        """Yield a database connection wrapped in a transaction."""
        if self.is_postgres and self._pg_pool:
            with self._pg_pool.connection() as conn:
                with conn.transaction():
                    yield conn
        else:
            with self._lock:
                conn = sqlite3.connect(str(self._sqlite_path), timeout=5.0)
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA journal_mode = WAL")
                conn.execute("PRAGMA busy_timeout = 5000")
                try:
                    yield conn
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
                finally:
                    conn.close()

    def run_migrations(self) -> None:
        """Run idempotent database migrations with proper indexes and constraints."""
        with self.connection() as conn:
            if self.is_postgres:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS user_contexts (
                        tenant_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        url TEXT,
                        title TEXT,
                        domain TEXT,
                        text TEXT NOT NULL,
                        word_count INT DEFAULT 0,
                        text_truncated BOOLEAN DEFAULT FALSE,
                        source TEXT DEFAULT 'extension',
                        captured_at TIMESTAMPTZ NOT NULL,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        PRIMARY KEY (tenant_id, user_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_user_contexts_lookup 
                        ON user_contexts(tenant_id, user_id);

                    CREATE TABLE IF NOT EXISTS mas_audit_logs (
                        id BIGSERIAL PRIMARY KEY,
                        tenant_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        run_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        agent_name TEXT NOT NULL,
                        details JSONB,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    );
                    CREATE INDEX IF NOT EXISTS idx_audit_tenant_user_run 
                        ON mas_audit_logs(tenant_id, user_id, run_id);
                    CREATE INDEX IF NOT EXISTS idx_audit_created 
                        ON mas_audit_logs(tenant_id, created_at DESC);

                    CREATE TABLE IF NOT EXISTS p2p_messages_store (
                        id BIGSERIAL PRIMARY KEY,
                        tenant_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        msg_id TEXT UNIQUE NOT NULL,
                        correlation_id TEXT,
                        sender TEXT NOT NULL,
                        recipient TEXT NOT NULL,
                        msg_type TEXT NOT NULL,
                        content JSONB,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        delivered_at TIMESTAMPTZ,
                        acknowledged BOOLEAN DEFAULT FALSE
                    );
                    CREATE INDEX IF NOT EXISTS idx_p2p_tenant_user_corr 
                        ON p2p_messages_store(tenant_id, user_id, correlation_id);
                """)
            else:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS user_contexts (
                        tenant_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        url TEXT,
                        title TEXT,
                        domain TEXT,
                        text TEXT NOT NULL,
                        word_count INTEGER DEFAULT 0,
                        text_truncated INTEGER DEFAULT 0,
                        source TEXT DEFAULT 'extension',
                        captured_at TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (tenant_id, user_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_user_contexts_lookup 
                        ON user_contexts(tenant_id, user_id);

                    CREATE TABLE IF NOT EXISTS mas_audit_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tenant_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        run_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        agent_name TEXT NOT NULL,
                        details TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE INDEX IF NOT EXISTS idx_audit_tenant_user_run 
                        ON mas_audit_logs(tenant_id, user_id, run_id);

                    CREATE TABLE IF NOT EXISTS p2p_messages_store (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tenant_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        msg_id TEXT UNIQUE NOT NULL,
                        correlation_id TEXT,
                        sender TEXT NOT NULL,
                        recipient TEXT NOT NULL,
                        msg_type TEXT NOT NULL,
                        content TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        delivered_at TIMESTAMP,
                        acknowledged INTEGER DEFAULT 0
                    );
                    CREATE INDEX IF NOT EXISTS idx_p2p_tenant_user_corr 
                        ON p2p_messages_store(tenant_id, user_id, correlation_id);
                """)
        logger.info("Database schema migrations verified and active.")

    # ── MULTI-TENANT CONTEXT OPERATIONS ──────────────────────────────────────

    def save_context(self, tenant_id: str, user_id: str, context: PageContext) -> None:
        """Persist user page context strictly scoped to tenant_id and user_id."""
        iso_captured = (
            context.captured_at.isoformat()
            if isinstance(context.captured_at, datetime)
            else str(context.captured_at)
        )
        with self.connection() as conn:
            if self.is_postgres:
                conn.execute(
                    """
                    INSERT INTO user_contexts (
                        tenant_id, user_id, url, title, domain, text, word_count, 
                        text_truncated, source, captured_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (tenant_id, user_id) DO UPDATE SET
                        url = EXCLUDED.url,
                        title = EXCLUDED.title,
                        domain = EXCLUDED.domain,
                        text = EXCLUDED.text,
                        word_count = EXCLUDED.word_count,
                        text_truncated = EXCLUDED.text_truncated,
                        source = EXCLUDED.source,
                        captured_at = EXCLUDED.captured_at,
                        created_at = NOW();
                    """,
                    (
                        tenant_id,
                        user_id,
                        context.url,
                        context.title,
                        context.domain,
                        context.text,
                        context.word_count,
                        context.text_truncated,
                        context.source,
                        iso_captured,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO user_contexts (
                        tenant_id, user_id, url, title, domain, text, word_count, 
                        text_truncated, source, captured_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (tenant_id, user_id) DO UPDATE SET
                        url = excluded.url,
                        title = excluded.title,
                        domain = excluded.domain,
                        text = excluded.text,
                        word_count = excluded.word_count,
                        text_truncated = excluded.text_truncated,
                        source = excluded.source,
                        captured_at = excluded.captured_at,
                        created_at = CURRENT_TIMESTAMP;
                    """,
                    (
                        tenant_id,
                        user_id,
                        context.url,
                        context.title,
                        context.domain,
                        context.text,
                        context.word_count,
                        1 if context.text_truncated else 0,
                        context.source,
                        iso_captured,
                    ),
                )

    def load_context(self, tenant_id: str, user_id: str) -> tuple[PageContext | None, float | None]:
        """Load user page context with strict tenant and user boundary."""
        with self.connection() as conn:
            param_ph = "%s" if self.is_postgres else "?"
            query = f"""
                SELECT url, title, domain, text, word_count, text_truncated, source, captured_at, created_at
                FROM user_contexts
                WHERE tenant_id = {param_ph} AND user_id = {param_ph}
            """
            cursor = conn.execute(query, (tenant_id, user_id))
            row = cursor.fetchone()
            if not row:
                return None, None

            if self.is_postgres:
                # row is a tuple or mapping from psycopg
                url, title, domain, text, word_count, truncated, source, captured_at, created_at = (
                    row[0],
                    row[1],
                    row[2],
                    row[3],
                    row[4],
                    row[5],
                    row[6],
                    row[7],
                    row[8],
                )
            else:
                url = row["url"]
                title = row["title"]
                domain = row["domain"]
                text = row["text"]
                word_count = row["word_count"]
                truncated = bool(row["text_truncated"])
                source = row["source"]
                captured_at = row["captured_at"]
                created_at = row["created_at"]

            parsed_captured = (
                datetime.fromisoformat(str(captured_at))
                if isinstance(captured_at, str)
                else captured_at
            )
            ctx = PageContext(
                url=url or "",
                title=title or "",
                domain=domain or "",
                text=text or "",
                word_count=int(word_count or 0),
                text_truncated=bool(truncated),
                source=source or "extension",
                captured_at=parsed_captured,
            )

            # Calculate age
            now = datetime.now(timezone.utc)
            if hasattr(parsed_captured, "tzinfo") and parsed_captured.tzinfo:
                age = max(0.0, (now - parsed_captured).total_seconds())
            else:
                age = 0.0

            return ctx, round(age, 2)

    def clear_context(self, tenant_id: str, user_id: str) -> bool:
        """Clear user page context with tenant isolation."""
        with self.connection() as conn:
            param_ph = "%s" if self.is_postgres else "?"
            query = f"DELETE FROM user_contexts WHERE tenant_id = {param_ph} AND user_id = {param_ph}"
            conn.execute(query, (tenant_id, user_id))
            return True

    # ── MULTI-TENANT AUDIT LOG OPERATIONS ─────────────────────────────────────

    def log_mas_event(
        self, tenant_id: str, user_id: str, run_id: str, event_type: str, agent_name: str, details: dict[str, Any]
    ) -> None:
        """Record an audit log entry tagged with tenant_id and user_id."""
        det_str = json.dumps(details)
        with self.connection() as conn:
            if self.is_postgres:
                conn.execute(
                    """
                    INSERT INTO mas_audit_logs (tenant_id, user_id, run_id, event_type, agent_name, details)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (tenant_id, user_id, run_id, event_type, agent_name, det_str),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO mas_audit_logs (tenant_id, user_id, run_id, event_type, agent_name, details)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (tenant_id, user_id, run_id, event_type, agent_name, det_str),
                )

    def get_mas_activity(
        self, tenant_id: str, user_id: str, run_id: str | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Retrieve audit logs strictly filtered by tenant_id and user_id."""
        with self.connection() as conn:
            param_ph = "%s" if self.is_postgres else "?"
            query = f"""
                SELECT id, run_id, event_type, agent_name, details, created_at
                FROM mas_audit_logs
                WHERE tenant_id = {param_ph} AND user_id = {param_ph}
            """
            params: list[Any] = [tenant_id, user_id]
            if run_id:
                query += f" AND run_id = {param_ph}"
                params.append(run_id)
            query += f" ORDER BY id DESC LIMIT {param_ph}"
            params.append(limit)

            cursor = conn.execute(query, tuple(params))
            rows = cursor.fetchall()

            events: list[dict[str, Any]] = []
            for r in rows:
                if self.is_postgres:
                    eid, erun, etype, eagent, edet, ecreated = r[0], r[1], r[2], r[3], r[4], r[5]
                else:
                    eid, erun, etype, eagent, edet, ecreated = (
                        r["id"],
                        r["run_id"],
                        r["event_type"],
                        r["agent_name"],
                        r["details"],
                        r["created_at"],
                    )
                if isinstance(edet, str):
                    try:
                        edet = json.loads(edet)
                    except Exception:
                        pass
                events.append({
                    "id": eid,
                    "run_id": erun,
                    "event_type": etype,
                    "agent_name": eagent,
                    "details": edet,
                    "created_at": str(ecreated),
                })
            return events


db = DatabaseManager()
