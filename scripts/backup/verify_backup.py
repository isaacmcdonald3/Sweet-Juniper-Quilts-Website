import argparse
import hashlib
import json
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any


def verify_archive(archive_path: Path) -> int:
    with tarfile.open(archive_path, mode="r:gz") as archive:
        members = archive.getmembers()
        member_by_name = {member.name: member for member in members}
        if len(member_by_name) != len(members):
            raise ValueError("Backup archive contains duplicate paths")

        manifest_member = member_by_name.get("manifest.json")
        if manifest_member is None or not manifest_member.isfile():
            raise ValueError("Backup archive is missing manifest.json")
        manifest_stream = archive.extractfile(manifest_member)
        if manifest_stream is None:
            raise ValueError("Backup manifest cannot be read")
        manifest: Any = json.load(manifest_stream)
        if (
            not isinstance(manifest, dict)
            or manifest.get("format") != 1
            or not isinstance(manifest.get("files"), list)
        ):
            raise ValueError("Backup manifest has an unsupported format")

        verified_paths: set[str] = set()
        for entry in manifest["files"]:
            if not isinstance(entry, dict):
                raise ValueError("Backup manifest contains an invalid file entry")
            name = entry.get("path")
            expected_size = entry.get("bytes")
            expected_hash = entry.get("sha256")
            if (
                not isinstance(name, str)
                or not name
                or PurePosixPath(name).is_absolute()
                or ".." in PurePosixPath(name).parts
                or name in verified_paths
                or not isinstance(expected_size, int)
                or not isinstance(expected_hash, str)
            ):
                raise ValueError("Backup manifest contains an invalid file entry")
            member = member_by_name.get(name)
            if member is None or not member.isfile():
                raise ValueError(f"Backup archive is missing {name}")
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError(f"Backup archive file cannot be read: {name}")

            digest = hashlib.sha256()
            byte_count = 0
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
                byte_count += len(chunk)
            if byte_count != expected_size:
                raise ValueError(f"Backup file size mismatch: {name}")
            if digest.hexdigest() != expected_hash:
                raise ValueError(f"Backup file SHA-256 mismatch: {name}")
            verified_paths.add(name)

        archive_paths = set(member_by_name) - {"manifest.json"}
        if verified_paths != archive_paths:
            raise ValueError("Backup archive contents do not match its manifest")
        return len(verified_paths)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify a packaged database backup.")
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    file_count = verify_archive(args.archive)
    print(f"Verified {file_count} files in {args.archive}")


if __name__ == "__main__":
    main()
