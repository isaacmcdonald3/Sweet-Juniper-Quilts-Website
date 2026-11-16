import csv
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from notify_failure import ISSUE_TITLE, notify_failure
from prepare_backup import (
    MEDIA_COLUMNS,
    REQUIRED_DATA_TABLES,
    REQUIRED_TABLES,
    create_archive,
    validate_exports,
)
from retention import expired_backup_keys
from verify_backup import verify_archive


class BackupToolsTest(unittest.TestCase):
    def make_export(self, root: Path) -> tuple[Path, Path]:
        export_dir = root / "export"
        export_dir.mkdir()
        schema = export_dir / "schema.sql"
        tables = REQUIRED_TABLES
        schema.write_text(
            "\n".join(f'CREATE TABLE "public"."{table}" ();' for table in tables),
            encoding="utf-8",
        )
        (export_dir / "roles.sql").write_text("CREATE ROLE app_owner;\n", encoding="utf-8")
        (export_dir / "data.sql").write_text(
            "\n".join(
                f'COPY "public"."{table}" ("id") FROM stdin;\n'
                for table in REQUIRED_DATA_TABLES
            ),
            encoding="utf-8",
        )
        (export_dir / "admin-audit-logs.sql").write_text(
            'COPY "public"."admin_audit_logs" '
            '("id", "actor_user_id", "action", "entity_type", "entity_id", "details", "created_at") FROM stdin;\n'
            r"\." + "\n",
            encoding="utf-8",
        )
        (export_dir / "migration-history-schema.sql").write_text(
            'CREATE TABLE "supabase_migrations"."schema_migrations" ();\n',
            encoding="utf-8",
        )
        (export_dir / "migration-history-data.sql").write_text(
            "COPY supabase_migrations.schema_migrations FROM stdin;\n",
            encoding="utf-8",
        )
        inventory = export_dir / "cloudinary-media-inventory.csv"
        with inventory.open("w", encoding="utf-8", newline="") as output:
            writer = csv.writer(output)
            writer.writerow(MEDIA_COLUMNS)
            writer.writerow([
                "product", "media-id", "product-id", "Quilt", "image", "asset",
                "public", "https://media.example/image", "", "", "", "true", "", "[]",
            ])
        return export_dir, schema

    def test_archive_validates_exports_and_contains_manifest_and_project_schema(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export_dir, _ = self.make_export(root)
            (root / "supabase" / "migrations").mkdir(parents=True)
            (root / "supabase" / "config.toml").write_text("[db]\nmajor_version = 15\n", encoding="utf-8")
            (root / "supabase" / "migrations" / "20261111000000_initial.sql").write_text(
                "create table public.products (id uuid);\n",
                encoding="utf-8",
            )
            (root / "scripts" / "backup").mkdir(parents=True)
            (root / "scripts" / "backup" / "verify_backup.py").write_text(
                "print('verifier')\n",
                encoding="utf-8",
            )
            output = root / "backup.tar.gz"
            create_archive(export_dir, output, root, "123", "https://github.com/example/repo/actions/runs/123")
            verify_archive(output)

            with tarfile.open(output, "r:gz") as archive:
                names = set(archive.getnames())
                self.assertIn("manifest.json", names)
                self.assertIn("project/supabase/config.toml", names)
                self.assertIn("project/supabase/migrations/20261111000000_initial.sql", names)
                self.assertIn("project/scripts/backup/verify_backup.py", names)
                manifest = json.load(archive.extractfile("manifest.json"))
                self.assertEqual(manifest["cloudinary_inventory_entries"], 1)
                self.assertEqual(manifest["workflow_run_id"], "123")
                self.assertEqual(
                    manifest["redacted_auth_references"],
                    ["public.admin_audit_logs.actor_user_id"],
                )

    def test_archive_verifier_rejects_changed_file_contents(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export_dir, _ = self.make_export(root)
            (root / "supabase" / "migrations").mkdir(parents=True)
            (root / "supabase" / "config.toml").write_text("[db]\n", encoding="utf-8")
            (root / "supabase" / "migrations" / "initial.sql").write_text(
                "create table public.products (id uuid);\n",
                encoding="utf-8",
            )
            (root / "scripts" / "backup").mkdir(parents=True)
            (root / "scripts" / "backup" / "verify_backup.py").write_text(
                "print('verifier')\n",
                encoding="utf-8",
            )
            archive_path = root / "backup.tar.gz"
            create_archive(export_dir, archive_path, root, "123", "https://example.test/run")

            altered_path = root / "altered.tar.gz"
            with tarfile.open(archive_path, "r:gz") as original, tarfile.open(
                altered_path, "w:gz"
            ) as altered:
                for member in original.getmembers():
                    content = original.extractfile(member)
                    if member.name == "data.sql":
                        original_data = content.read()
                        changed = b"X" + original_data[1:]
                        member.size = len(changed)
                        content = io.BytesIO(changed)
                    if content is not None:
                        altered.addfile(member, content)

            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                verify_archive(altered_path)

    def test_archive_rejects_missing_required_table(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export_dir, schema = self.make_export(root)
            schema.write_text('CREATE TABLE "public"."products" ();\n', encoding="utf-8")
            (export_dir / "data.sql").write_text(
                'COPY "public"."products" ("id") FROM stdin;\n',
                encoding="utf-8",
            )
            (root / "supabase" / "migrations").mkdir(parents=True)
            (root / "supabase" / "config.toml").write_text("[db]\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "public.categories"):
                create_archive(export_dir, root / "backup.tar.gz", root, "123", "https://example.test/run")

    def test_archive_rejects_missing_core_data_export(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export_dir, _ = self.make_export(root)
            data = export_dir / "data.sql"
            data.write_text('COPY "public"."products" ("id") FROM stdin;\n', encoding="utf-8")
            (root / "supabase" / "migrations").mkdir(parents=True)
            (root / "supabase" / "config.toml").write_text("[db]\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Data export is missing public.categories"):
                create_archive(export_dir, root / "backup.tar.gz", root, "123", "https://example.test/run")

    def test_archive_rejects_unredacted_audit_actor_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            export_dir, _ = self.make_export(Path(temporary))
            (export_dir / "admin-audit-logs.sql").write_text(
                'COPY "public"."admin_audit_logs" '
                '("id", "actor_user_id", "action", "entity_type", "entity_id", "details", "created_at") FROM stdin;\n'
                "id\t12345678-1234-1234-1234-123456789012\taction\ttype\tentity\t{}\t2026-01-01\n"
                r"\." + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "actor IDs must be redacted"):
                validate_exports(export_dir)

    def test_retention_keeps_newest_thirty_and_requires_new_upload(self) -> None:
        objects = [
            {
                "Key": f"sweet-juniper/daily/backup-{index:02}.tar.gz.age",
                "LastModified": f"2026-11-{(index % 28) + 1:02}T00:00:00+00:00",
            }
            for index in range(35)
        ]
        objects.sort(key=lambda item: item["LastModified"])
        newest = objects[-1]["Key"]
        expired = expired_backup_keys({"Contents": objects}, "sweet-juniper/daily/", newest)
        self.assertEqual(len(expired), 5)
        with self.assertRaisesRegex(ValueError, "newly uploaded backup"):
            expired_backup_keys({"Contents": objects}, "sweet-juniper/daily/", "missing.tar.gz.age")

    def test_failure_notification_creates_and_reuses_one_issue(self) -> None:
        environment = {
            "GITHUB_TOKEN": "test-token",
            "GITHUB_REPOSITORY": "owner/repo",
            "GITHUB_REPOSITORY_OWNER": "owner",
            "GITHUB_RUN_ID": "789",
            "GITHUB_RUN_ATTEMPT": "1",
        }
        calls: list[tuple[str, str, dict | None]] = []

        class FakeResponse:
            def __init__(self, value: dict) -> None:
                self.value = value

            def __enter__(self) -> "FakeResponse":
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def read(self) -> bytes:
                return json.dumps(self.value).encode("utf-8")

        def fake_open_url(request, timeout: int) -> FakeResponse:
            payload = json.loads(request.data) if request.data else None
            calls.append((request.method, request.full_url, payload))
            if request.method == "GET":
                return FakeResponse([])
            return FakeResponse({"html_url": "https://github.com/owner/repo/issues/1"})

        url = notify_failure(environment, fake_open_url)
        self.assertEqual(url, "https://github.com/owner/repo/issues/1")
        self.assertEqual(calls[-1][2]["title"], ISSUE_TITLE)
        self.assertIn("previous backup", calls[-1][2]["body"])

        calls.clear()
        def open_existing(request, timeout: int) -> FakeResponse:
            payload = json.loads(request.data) if request.data else None
            calls.append((request.method, request.full_url, payload))
            if request.method == "GET":
                return FakeResponse([{"number": 7, "title": ISSUE_TITLE}])
            return FakeResponse({"html_url": "https://github.com/owner/repo/issues/7#issuecomment-1"})

        url = notify_failure(environment, open_existing)
        self.assertIn("/issues/7/comments", calls[-1][1])
        self.assertEqual(url, "https://github.com/owner/repo/issues/7#issuecomment-1")


if __name__ == "__main__":
    unittest.main()
