"""Local knowledge base for the Python agent path.

The web app has its own Supabase-backed knowledge base. This module gives the
Python MAS a self-contained store so an agent run can ground itself in the
reader's own documents without a database server.

Design notes
------------
* SQLite (WAL, one connection behind an ``RLock``) keeps the store portable and
  consistent with the blackboard and P2P mailbox already used by the MAS.
* Chunking is character-based with sentence/paragraph boundaries and overlap.
* Embeddings are **deterministic hashed bag-of-words vectors**, not a neural
  model. They are labelled ``hash-bow-v1`` everywhere they surface. Retrieval
  combines cosine similarity with token overlap, so it is a real lexical
  retriever, but it is not claimed to be semantic search.
* Write operations can be two-phase: ``save_with_confirmation`` returns a
  single-use token first and writes nothing until that token is presented back.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import re
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EMBEDDING_MODEL = "hash-bow-v1"
EMBEDDING_DIM = 256
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
MAX_CONTENT_CHARS = 400_000
MAX_TITLE_CHARS = 300
MAX_SOURCE_CHARS = 4096
MIN_CONTENT_CHARS = 40
CONFIRMATION_TTL_SECONDS = 300
MAX_CANDIDATE_CHUNKS = 5000

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'_-]*")
_STOPWORDS = frozenset(
    """
    a an and are as at be been but by can could did do does for from had has have
    how i if in into is it its just me more most my no nor not of on or our out
    over own same she should so some such than that the their them then there
    these they this those through to too under until up very was we were what
    when where which while who why will with would you your
    """.split()
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalise_text(raw: str) -> str:
    """Collapse whitespace and drop control characters (same rule as the app)."""
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks on paragraph/sentence boundaries."""
    clean = normalise_text(text)
    if not clean:
        return []
    if len(clean) <= size:
        return [clean]

    chunks: list[str] = []
    start = 0
    while start < len(clean):
        end = min(start + size, len(clean))
        if end < len(clean):
            window = clean[start:end]
            boundary = max(
                window.rfind("\n\n"),
                window.rfind(". "),
                window.rfind("? "),
                window.rfind("! "),
                window.rfind("\n"),
            )
            if boundary > size * 0.5:
                end = start + boundary + 1
        piece = clean[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(clean):
            break
        start = max(end - overlap, start + 1)
    return chunks


def _tokens(text: str) -> list[str]:
    return [token for token in _TOKEN_RE.findall((text or "").lower()) if token not in _STOPWORDS]


def embed_text(text: str) -> list[float]:
    """Return a deterministic, L2-normalised hashed bag-of-words vector."""
    vector = [0.0] * EMBEDDING_DIM
    tokens = _tokens(text)
    features = list(tokens)
    features.extend(f"{left} {right}" for left, right in zip(tokens, tokens[1:]))
    for feature in features:
        digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "big") % EMBEDDING_DIM
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def _cosine(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def _content_hash(content: str) -> str:
    return hashlib.sha256(normalise_text(content).encode("utf-8")).hexdigest()


def _document_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "source_url": row["source_url"],
        "content_hash": row["content_hash"],
        "char_count": row["char_count"],
        "chunk_count": row["chunk_count"],
        "created_at": row["created_at"],
        "embedding_model": EMBEDDING_MODEL,
    }


class KnowledgeStore:
    """SQLite-backed document store with deterministic lexical retrieval."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_db()

    # -- infrastructure ---------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.db_path), timeout=10.0, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    @contextlib.contextmanager
    def _session(self) -> Any:
        """Transactional session that always closes the connection.

        ``sqlite3.Connection`` used as a context manager only commits or rolls
        back; it never closes. Leaving sockets/files open breaks Windows
        cleanup, so every unit of work goes through here.
        """
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _init_db(self) -> None:
        with self._lock, self._session() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS knowledge_documents (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    source_url TEXT NOT NULL DEFAULT '',
                    content TEXT NOT NULL,
                    content_hash TEXT NOT NULL UNIQUE,
                    char_count INTEGER NOT NULL,
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_chunks (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
                    chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    embedding TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document
                    ON knowledge_chunks(document_id);
                CREATE TABLE IF NOT EXISTS knowledge_confirmations (
                    token TEXT PRIMARY KEY,
                    content_hash TEXT NOT NULL,
                    title TEXT NOT NULL,
                    source_url TEXT NOT NULL DEFAULT '',
                    expires_at REAL NOT NULL,
                    created_at REAL NOT NULL,
                    consumed_at REAL
                );
                """
            )

    # -- writes -----------------------------------------------------------
    def save_document(
        self,
        title: str,
        content: str,
        source_url: str = "",
    ) -> dict[str, Any]:
        """Store a document and its chunks. Idempotent by content hash."""
        clean_title = normalise_text(title)[:MAX_TITLE_CHARS]
        clean_content = normalise_text(content)
        clean_source = (source_url or "").strip()[:MAX_SOURCE_CHARS]
        if not clean_title:
            raise ValueError("title is required")
        if len(clean_content) < MIN_CONTENT_CHARS:
            raise ValueError(f"content must be at least {MIN_CONTENT_CHARS} characters")
        if len(clean_content) > MAX_CONTENT_CHARS:
            raise ValueError(f"content must be at most {MAX_CONTENT_CHARS} characters")

        content_hash = _content_hash(clean_content)
        chunks = chunk_text(clean_content)
        if not chunks:
            raise ValueError("content produced no readable chunks")

        with self._lock, self._session() as connection:
            existing = connection.execute(
                "SELECT * FROM knowledge_documents WHERE content_hash = ?", (content_hash,)
            ).fetchone()
            if existing is not None:
                document = _document_row(existing)
                document["created"] = False
                return document

            document_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO knowledge_documents
                    (id, title, source_url, content, content_hash, char_count, chunk_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    clean_title,
                    clean_source,
                    clean_content,
                    content_hash,
                    len(clean_content),
                    len(chunks),
                    _utc_now(),
                ),
            )
            connection.executemany(
                """
                INSERT INTO knowledge_chunks (id, document_id, chunk_index, content, embedding)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (
                        str(uuid.uuid4()),
                        document_id,
                        index,
                        chunk,
                        json.dumps(embed_text(chunk)),
                    )
                    for index, chunk in enumerate(chunks)
                ],
            )
            row = connection.execute(
                "SELECT * FROM knowledge_documents WHERE id = ?", (document_id,)
            ).fetchone()

        document = _document_row(row)
        document["created"] = True
        return document

    def save_with_confirmation(
        self,
        title: str,
        content: str,
        source_url: str = "",
        confirmation_token: str = "",
    ) -> dict[str, Any]:
        """Two-phase write: request a token, then present it to save.

        Nothing is written on the first call. A token is bound to the exact
        content hash and is single-use.
        """
        clean_title = normalise_text(title)[:MAX_TITLE_CHARS]
        clean_content = normalise_text(content)
        if not clean_title:
            raise ValueError("title is required")
        if len(clean_content) < MIN_CONTENT_CHARS:
            raise ValueError(f"content must be at least {MIN_CONTENT_CHARS} characters")
        if len(clean_content) > MAX_CONTENT_CHARS:
            raise ValueError(f"content must be at most {MAX_CONTENT_CHARS} characters")
        content_hash = _content_hash(clean_content)
        now = time.time()

        with self._lock, self._session() as connection:
            connection.execute(
                "DELETE FROM knowledge_confirmations WHERE expires_at < ? AND consumed_at IS NULL",
                (now - CONFIRMATION_TTL_SECONDS,),
            )
            if not confirmation_token:
                token = secrets.token_urlsafe(24)
                expires_at = now + CONFIRMATION_TTL_SECONDS
                connection.execute(
                    """
                    INSERT INTO knowledge_confirmations
                        (token, content_hash, title, source_url, expires_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        token,
                        content_hash,
                        normalise_text(title)[:MAX_TITLE_CHARS],
                        (source_url or "").strip()[:MAX_SOURCE_CHARS],
                        expires_at,
                        now,
                    ),
                )
                return {
                    "status": "confirmation_required",
                    "saved": False,
                    "requires_confirmation": True,
                    "confirmation_token": token,
                    "content_hash": content_hash,
                    "expires_at": datetime.fromtimestamp(expires_at, timezone.utc).isoformat(),
                }

            record = connection.execute(
                "SELECT * FROM knowledge_confirmations WHERE token = ?", (confirmation_token,)
            ).fetchone()
            if record is None:
                return {
                    "status": "rejected",
                    "saved": False,
                    "error": "Unknown confirmation token.",
                }
            if record["consumed_at"] is not None:
                return {
                    "status": "rejected",
                    "saved": False,
                    "error": "Confirmation token has already been used.",
                }
            if record["expires_at"] < now:
                return {
                    "status": "rejected",
                    "saved": False,
                    "error": "Confirmation token has expired.",
                }
            if record["content_hash"] != content_hash:
                return {
                    "status": "rejected",
                    "saved": False,
                    "error": "Confirmation token does not match this content.",
                }
            connection.execute(
                "UPDATE knowledge_confirmations SET consumed_at = ? WHERE token = ?",
                (now, confirmation_token),
            )

        document = self.save_document(title, content, source_url)
        document["status"] = "saved"
        document["saved"] = True
        return document

    def delete_document(self, document_id: str) -> bool:
        with self._lock, self._session() as connection:
            cursor = connection.execute(
                "DELETE FROM knowledge_documents WHERE id = ?", (document_id,)
            )
            return cursor.rowcount > 0

    # -- reads ------------------------------------------------------------
    def list_documents(self, limit: int = 50) -> list[dict[str, Any]]:
        capped = max(1, min(int(limit), 200))
        with self._lock, self._session() as connection:
            rows = connection.execute(
                "SELECT * FROM knowledge_documents ORDER BY created_at DESC LIMIT ?",
                (capped,),
            ).fetchall()
        return [_document_row(row) for row in rows]

    def search(self, query: str, limit: int = 5, min_score: float = 0.12) -> list[dict[str, Any]]:
        """Return the best matching chunks with a transparent similarity score."""
        clean_query = normalise_text(query)
        query_tokens = set(_tokens(clean_query))
        if not clean_query or not query_tokens:
            return []
        query_vector = embed_text(clean_query)
        capped = max(1, min(int(limit), 20))

        with self._lock, self._session() as connection:
            rows = connection.execute(
                """
                SELECT c.id AS chunk_id, c.document_id, c.chunk_index, c.content, c.embedding,
                       d.title, d.source_url
                FROM knowledge_chunks c
                JOIN knowledge_documents d ON d.id = c.document_id
                LIMIT ?
                """,
                (MAX_CANDIDATE_CHUNKS,),
            ).fetchall()

        scored: list[dict[str, Any]] = []
        for row in rows:
            chunk_tokens = set(_tokens(row["content"]))
            overlap = len(query_tokens & chunk_tokens) / len(query_tokens)
            if overlap == 0:
                continue
            cosine = _cosine(query_vector, json.loads(row["embedding"]))
            score = 0.65 * max(cosine, 0.0) + 0.35 * overlap
            if score < min_score:
                continue
            scored.append(
                {
                    "chunk_id": row["chunk_id"],
                    "document_id": row["document_id"],
                    "document_title": row["title"],
                    "source_url": row["source_url"],
                    "chunk_index": row["chunk_index"],
                    "content": row["content"],
                    "score": round(score, 4),
                    "citation": f"{row['title']} (part {row['chunk_index'] + 1})",
                }
            )

        scored.sort(key=lambda item: (-item["score"], item["document_title"], item["chunk_index"]))
        return scored[:capped]

    def stats(self) -> dict[str, Any]:
        with self._lock, self._session() as connection:
            documents = connection.execute(
                "SELECT COUNT(*) AS count FROM knowledge_documents"
            ).fetchone()["count"]
            chunks = connection.execute("SELECT COUNT(*) AS count FROM knowledge_chunks").fetchone()[
                "count"
            ]
        return {
            "documents": documents,
            "chunks": chunks,
            "embedding_model": EMBEDDING_MODEL,
            "embedding_dimensions": EMBEDDING_DIM,
            "semantic_search": False,
            "db_path": str(self.db_path),
        }


_store: KnowledgeStore | None = None
_store_path: str | None = None
_store_lock = threading.Lock()


def get_knowledge_store(db_path: str | Path | None = None) -> KnowledgeStore:
    """Process-wide store. ``KNOWLEDGE_DB`` or an explicit path overrides the default."""
    global _store, _store_path
    import os

    from mas.config import config

    resolved = str(db_path or os.getenv("KNOWLEDGE_DB") or config.KNOWLEDGE_DB)
    with _store_lock:
        if _store is None or _store_path != resolved:
            _store = KnowledgeStore(resolved)
            _store_path = resolved
        return _store


def reset_knowledge_store() -> None:
    """Drop the cached instance (tests use this after pointing env at a temp DB)."""
    global _store, _store_path
    with _store_lock:
        _store = None
        _store_path = None
