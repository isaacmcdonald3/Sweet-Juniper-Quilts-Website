import argparse
import csv
import hashlib
import json
import re
import tarfile
from datetime import datetime, timezone
from pathlib import Path


EXPORT_FILES = (
    "roles.sql",
    "schema.sql",
    "data.sql",
    "admin-audit-logs.sql",
    "migration-history-schema.sql",
    "migration-history-data.sql",
    "cloudinary-media-inventory.csv",
)
MEDIA_COLUMNS = (
    "asset_scope",
    "media_id",
    "product_id",
    "product_name",
    "media_type",
    "cloudinary_asset_id",
    "cloudinary_public_id",
    "media_url",
    "poster_cloudinary_asset_id",
    "poster_cloudinary_public_id",
    "poster_url",
    "is_primary",
    "deleted_at",
    "cleanup_pending_assets",
)
REQUIRED_TABLES = (
    "categories",
    "products",
    "product_media",
    "homepage_media",
    "orders",
    "order_items",
    "payments",
    "homepage_content",
    "email_logs",
    "admin_audit_logs",
    "checkout_reservations",
    "checkout_reservation_items",
    "paypal_webhook_events",
    "contact_submissions",
    "resend_webhook_events",
)
REQUIRED_DATA_TABLES = tuple(
    table for table in REQUIRED_TABLES if table != "admin_audit_logs"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_exports(export_dir: Path) -> tuple[int, list[Path]]:
    files = [export_dir / name for name in EXPORT_FILES]
    for path in files:
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Required export is missing or empty: {path.name}")

    schema = (export_dir / "schema.sql").read_text(encoding="utf-8", errors="replace")
    for table in REQUIRED_TABLES:
        table_declaration = re.compile(
            rf'CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"public"\."{re.escape(table)}"',
            re.IGNORECASE,
        )
        if not table_declaration.search(schema):
            raise ValueError(f"Schema export is missing public.{table}")

    required_data_tables = set(REQUIRED_DATA_TABLES)
    copy_statement = re.compile(r'^COPY\s+"public"\."([^"]+)"\s*\(', re.IGNORECASE)
    with (export_dir / "data.sql").open(encoding="utf-8", errors="replace") as data:
        for line in data:
            match = copy_statement.match(line)
            if match:
                required_data_tables.discard(match.group(1))
    if required_data_tables:
        raise ValueError(f"Data export is missing public.{sorted(required_data_tables)[0]}")

    audit_header = (
        'COPY "public"."admin_audit_logs" '
        '("id", "actor_user_id", "action", "entity_type", "entity_id", "details", "created_at") FROM stdin;'
    )
    with (export_dir / "admin-audit-logs.sql").open(
        encoding="utf-8", errors="replace"
    ) as audit_dump:
        if audit_dump.readline().rstrip("\r\n") != audit_header:
            raise ValueError("Administrative audit-log export has an invalid COPY format")
        found_terminator = False
        for line in audit_dump:
            row = line.rstrip("\r\n")
            if row == r"\.":
                found_terminator = True
                if any(trailing.strip() for trailing in audit_dump):
                    raise ValueError("Administrative audit-log export has trailing data")
                break
            columns = row.split("\t")
            if len(columns) != 7 or columns[1] != r"\N":
                raise ValueError("Administrative audit-log actor IDs must be redacted")
        if not found_terminator:
            raise ValueError("Administrative audit-log export is incomplete")

    with (export_dir / "cloudinary-media-inventory.csv").open(
        encoding="utf-8", newline=""
    ) as inventory:
        reader = csv.reader(inventory)
        if tuple(next(reader, ())) != MEDIA_COLUMNS:
            raise ValueError("Cloudinary media inventory has an unexpected header")
        media_count = 0
        for row in reader:
            if len(row) != len(MEDIA_COLUMNS):
                raise ValueError("Cloudinary media inventory contains a malformed row")
            media_count += 1

    return media_count, files


def create_archive(
    export_dir: Path,
    output: Path,
    source_root: Path,
    run_id: str,
    run_url: str,
) -> None:
    media_count, export_files = validate_exports(export_dir)
    config = source_root / "supabase" / "config.toml"
    migrations = sorted((source_root / "supabase" / "migrations").glob("*.sql"))
    if not config.is_file() or not migrations:
        raise ValueError("Supabase config or migration files are missing")

    entries = [
        {
            "path": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in export_files
    ]
    verifier = source_root / "scripts" / "backup" / "verify_backup.py"
    if not verifier.is_file():
        raise ValueError("Backup integrity verifier is missing")
    project_files = [
        (config, "project/supabase/config.toml"),
        *(
            (path, f"project/supabase/migrations/{path.name}")
            for path in migrations
        ),
        (verifier, "project/scripts/backup/verify_backup.py"),
    ]
    entries.extend(
        {
            "path": archive_path,
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path, archive_path in project_files
    )
    manifest = {
        "format": 1,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "workflow_run_id": run_id,
        "workflow_run_url": run_url,
        "cloudinary_inventory_entries": media_count,
        "redacted_auth_references": ["public.admin_audit_logs.actor_user_id"],
        "files": entries,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError(f"Refusing to overwrite an existing backup archive: {output}")

    manifest_path = export_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    with tarfile.open(output, mode="w:gz") as archive:
        for path in export_files:
            archive.add(path, arcname=path.name)
        archive.add(manifest_path, arcname="manifest.json")
        for path, archive_path in project_files:
            archive.add(path, arcname=archive_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and package a Supabase export.")
    parser.add_argument("--export-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-url", required=True)
    args = parser.parse_args()
    create_archive(
        args.export_dir,
        args.output,
        args.source_root,
        args.run_id,
        args.run_url,
    )
    print(f"Validated backup archive: {args.output}")


if __name__ == "__main__":
    main()
