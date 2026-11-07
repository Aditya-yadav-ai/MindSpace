"""MindSpace Database Administration CLI.

Usage:
    python -m scripts.db_admin status
    python -m scripts.db_admin migrate
    python -m scripts.db_admin backup [--dir <target_dir>]
    python -m scripts.db_admin restore --file <backup_file>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Ensure apps/api is in sys.path
api_root = Path(__file__).resolve().parent.parent
if str(api_root) not in sys.path:
    sys.path.insert(0, str(api_root))

from app.database import db


def main() -> None:
    parser = argparse.ArgumentParser(description="MindSpace Database Administration Tool")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Status
    subparsers.add_parser("status", help="Show database health and applied migrations")

    # Migrate
    subparsers.add_parser("migrate", help="Run pending database schema migrations")

    # Backup
    backup_parser = subparsers.add_parser("backup", help="Create a point-in-time database backup")
    backup_parser.add_argument("--dir", default=None, help="Optional destination directory for backup")

    # Restore
    restore_parser = subparsers.add_parser("restore", help="Restore database from a backup file")
    restore_parser.add_argument("--file", required=True, help="Path to backup file")

    # Seed Demo Data
    subparsers.add_parser("seed", help="Seed realistic demonstration data into demo-tenant")

    # Reset Demo Data
    subparsers.add_parser("reset", help="Purge and reseed demo tenant data")

    args = parser.parse_args()

    if args.command == "status":
        health = db.get_health_status()
        print(f"Engine: {health.get('engine')} (PostgreSQL: {health.get('is_postgres')})")
        print(f"Connected: {health.get('connected')}")
        print("Applied Migrations:")
        for m in db.get_applied_migrations():
            print(f"  - [{m['version']}] {m['applied_at']}: {m['description']}")

    elif args.command == "migrate":
        print("Running database migrations...")
        db.run_migrations()
        print("Migrations successfully applied.")

    elif args.command == "backup":
        print("Creating point-in-time database backup...")
        backup_path = db.backup_database(args.dir)
        print(f"Backup created successfully: {backup_path}")

    elif args.command == "restore":
        print(f"Restoring database from {args.file}...")
        db.restore_database(args.file)
        print("Database successfully restored.")

    elif args.command == "seed":
        print("Seeding demo data into demo-tenant...")
        res = db.seed_demo_data()
        print(f"Demo data seeded successfully: run_id={res.get('run_id')} url={res.get('context_url')}")

    elif args.command == "reset":
        print("Resetting demo data...")
        res = db.reset_demo_data()
        print(f"Demo data reset and reseeded: run_id={res.get('run_id')}")


if __name__ == "__main__":
    main()

