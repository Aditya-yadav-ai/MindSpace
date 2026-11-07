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
        """Run idempotent database migrations with proper indexes, constraints, and version tracking."""
        with self.connection() as conn:
            if self.is_postgres:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                        version TEXT PRIMARY KEY,
                        applied_at TIMESTAMPTZ DEFAULT NOW(),
                        description TEXT
                    );

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

                    INSERT INTO schema_migrations (version, description)
                    VALUES ('001_core_schema', 'Initial multi-tenant schema with compound keys')
                    ON CONFLICT (version) DO NOTHING;
                """)
            else:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                        version TEXT PRIMARY KEY,
                        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        description TEXT
                    );

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

                    INSERT OR IGNORE INTO schema_migrations (version, description)
                    VALUES ('001_core_schema', 'Initial multi-tenant schema with compound keys');
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

    # ── USER DATA LIFECYCLE & GDPR PURGE ────────────────────────────────────

    def purge_user_data(self, tenant_id: str, user_id: str) -> dict[str, int]:
        """Completely purge all context, audit logs, and P2P messages for a user (GDPR Right to Erasure)."""
        purged = {"user_contexts": 0, "mas_audit_logs": 0, "p2p_messages_store": 0}
        with self.connection() as conn:
            param_ph = "%s" if self.is_postgres else "?"
            
            # 1. Purge user contexts
            cursor = conn.execute(
                f"DELETE FROM user_contexts WHERE tenant_id = {param_ph} AND user_id = {param_ph}",
                (tenant_id, user_id),
            )
            purged["user_contexts"] = getattr(cursor, "rowcount", 0) or 0

            # 2. Purge audit logs
            cursor = conn.execute(
                f"DELETE FROM mas_audit_logs WHERE tenant_id = {param_ph} AND user_id = {param_ph}",
                (tenant_id, user_id),
            )
            purged["mas_audit_logs"] = getattr(cursor, "rowcount", 0) or 0

            # 3. Purge P2P messages
            cursor = conn.execute(
                f"DELETE FROM p2p_messages_store WHERE tenant_id = {param_ph} AND user_id = {param_ph}",
                (tenant_id, user_id),
            )
            purged["p2p_messages_store"] = getattr(cursor, "rowcount", 0) or 0

        logger.info("Purged user data for tenant=%s user=%s: %s", tenant_id, user_id, purged)
        return purged

    # ── DEMONSTRATION & SAMPLE DATA SEEDING ──────────────────────────────────

    def seed_demo_data(self, tenant_id: str = "demo-tenant", user_id: str = "demo-user") -> dict[str, Any]:
        """Seed high-quality, realistic demonstration data strictly isolated to demo tenant/user."""
        demo_text = (
            "Attention Is All You Need (Vaswani et al., 2017) introduced the Transformer, a novel "
            "neural network architecture based entirely on attention mechanisms, dispensing with recurrence "
            "and convolutions entirely. The Transformer allows for significantly more parallelization and can "
            "reach a new state of the art in translation quality after being trained for as little as twelve hours "
            "on eight P100 GPUs. Key components include Multi-Head Scaled Dot-Product Attention, Positional "
            "Encoding, and sinusoidal embeddings to encode sequence order without sequential computation overhead."
        )
        context = PageContext(
            url="https://arxiv.org/abs/1706.03762",
            title="Attention Is All You Need — Transformer Architecture",
            domain="arxiv.org",
            text=demo_text,
            source="manual",
        )
        self.save_context(tenant_id, user_id, context)

        # Seed realistic agent events
        run_id = "demo-run-stage8"
        self.log_mas_event(
            tenant_id,
            user_id,
            run_id,
            "goal_planned",
            "manager_agent",
            {
                "goal": "Explain the Transformer multi-head attention mechanism and extract key equations",
                "selected_agents": ["vision_agent", "research_agent", "rag_agent", "report_agent"],
                "offline_mode": True,
            },
        )
        self.log_mas_event(
            tenant_id,
            user_id,
            run_id,
            "mcp_tool_execution",
            "research_agent",
            {
                "tool": "extract_facts",
                "facts_found": 3,
                "citations": ["Vaswani et al. (2017)", "Section 3.2 Multi-Head Attention"],
            },
        )
        self.log_mas_event(
            tenant_id,
            user_id,
            run_id,
            "synthesis_complete",
            "report_agent",
            {
                "summary": "Multi-Head Attention projects queries, keys, and values h times with learned linear projections.",
                "verified": True,
                "confidence_score": 0.98,
            },
        )

        # Seed sample P2P message
        with self.connection() as conn:
            param_ph = "%s" if self.is_postgres else "?"
            conn.execute(
                f"""
                INSERT INTO p2p_messages_store (
                    tenant_id, user_id, msg_id, correlation_id, sender, recipient, msg_type, content, acknowledged
                ) VALUES ({param_ph}, {param_ph}, {param_ph}, {param_ph}, {param_ph}, {param_ph}, {param_ph}, {param_ph}, {param_ph})
                ON CONFLICT (msg_id) DO NOTHING;
                """,
                (
                    tenant_id,
                    user_id,
                    "msg-demo-001",
                    "corr-demo-001",
                    "manager_agent",
                    "research_agent",
                    "task_dispatch",
                    json.dumps({"subtask": "Extract computational complexity per layer"}),
                    1,
                ),
            )

        logger.info("Seeded demo data for tenant=%s, user=%s", tenant_id, user_id)
        return {
            "seeded": True,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "context_url": context.url,
            "run_id": run_id,
        }

    def reset_demo_data(self, tenant_id: str = "demo-tenant", user_id: str = "demo-user") -> dict[str, Any]:
        """Purge and cleanly reseed demonstration data."""
        self.purge_user_data(tenant_id, user_id)
        return self.seed_demo_data(tenant_id, user_id)

    # ── MIGRATIONS & VERSIONING ──────────────────────────────────────────────

    def get_applied_migrations(self) -> list[dict[str, Any]]:
        """Return list of applied database schema migrations."""
        with self.connection() as conn:
            cursor = conn.execute("SELECT version, applied_at, description FROM schema_migrations ORDER BY version ASC")
            rows = cursor.fetchall()
            results = []
            for r in rows:
                if self.is_postgres:
                    results.append({"version": r[0], "applied_at": str(r[1]), "description": r[2]})
                else:
                    results.append({"version": r["version"], "applied_at": str(r["applied_at"]), "description": r["description"]})
            return results

    # ── BACKUP & RESTORE ─────────────────────────────────────────────────────

    def backup_database(self, destination_dir: str | Path | None = None) -> str:
        """Create a point-in-time backup of the database."""
        import shutil
        target_dir = Path(destination_dir) if destination_dir else Path(__file__).resolve().parent.parent / "backups"
        target_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

        if not self.is_postgres:
            backup_file = target_dir / f"mindspace_backup_{timestamp}.sqlite"
            with self._lock:
                with self.connection() as conn:
                    # SQLite backup API
                    backup_conn = sqlite3.connect(str(backup_file))
                    conn.backup(backup_conn)
                    backup_conn.close()
            logger.info("Created SQLite database backup at %s", backup_file)
            return str(backup_file)
        else:
            # Export structured table dumps for PostgreSQL
            backup_file = target_dir / f"mindspace_pg_backup_{timestamp}.json"
            dump_data: dict[str, list[dict[str, Any]]] = {}
            with self.connection() as conn:
                for table in ["user_contexts", "mas_audit_logs", "p2p_messages_store", "schema_migrations"]:
                    cursor = conn.execute(f"SELECT * FROM {table}")
                    cols = [desc[0] for desc in cursor.description]
                    rows = cursor.fetchall()
                    table_rows = []
                    for row in rows:
                        row_dict = {}
                        for i, col in enumerate(cols):
                            val = row[i]
                            if isinstance(val, (datetime, Path)):
                                val = str(val)
                            row_dict[col] = val
                        table_rows.append(row_dict)
                    dump_data[table] = table_rows
            with open(backup_file, "w", encoding="utf-8") as fp:
                json.dump(dump_data, fp, indent=2, default=str)
            logger.info("Created PostgreSQL table export backup at %s", backup_file)
            return str(backup_file)

    def restore_database(self, backup_file: str | Path) -> bool:
        """Restore database state from a backup file."""
        import shutil
        file_path = Path(backup_file)
        if not file_path.exists():
            raise FileNotFoundError(f"Backup file not found: {backup_file}")

        if not self.is_postgres:
            with self._lock:
                # Copy backup file over current SQLite file
                shutil.copy2(str(file_path), str(self._sqlite_path))
            self.run_migrations()
            logger.info("Restored SQLite database from %s", file_path)
            return True
        else:
            with open(file_path, "r", encoding="utf-8") as fp:
                dump_data = json.load(fp)
            with self.connection() as conn:
                for table, rows in dump_data.items():
                    if not rows:
                        continue
                    cols = list(rows[0].keys())
                    col_str = ", ".join(cols)
                    ph_str = ", ".join(["%s"] * len(cols))
                    for row in rows:
                        vals = [row.get(c) for c in cols]
                        conn.execute(
                            f"INSERT INTO {table} ({col_str}) VALUES ({ph_str}) ON CONFLICT DO NOTHING",
                            tuple(vals),
                        )
            logger.info("Restored PostgreSQL database tables from %s", file_path)
            return True

    def get_health_status(self) -> dict[str, Any]:
        """Return connectivity and engine health metrics."""
        try:
            with self.connection() as conn:
                conn.execute("SELECT 1")
            return {
                "status": "healthy",
                "engine": "postgresql" if self.is_postgres else "sqlite",
                "is_postgres": self.is_postgres,
                "connected": True,
            }
        except Exception as e:
            return {
                "status": "unhealthy",
                "engine": "postgresql" if self.is_postgres else "sqlite",
                "is_postgres": self.is_postgres,
                "connected": False,
                "error": str(e),
            }


db = DatabaseManager()

