import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any


def expired_backup_keys(
    response: dict[str, Any],
    prefix: str,
    protected_key: str,
    keep: int = 30,
) -> list[str]:
    contents = response.get("Contents", [])
    if not isinstance(contents, list):
        raise ValueError("R2 object listing has an invalid Contents value")

    backups: list[tuple[datetime, str]] = []
    for item in contents:
        if not isinstance(item, dict):
            continue
        key = item.get("Key")
        modified = item.get("LastModified")
        if not isinstance(key, str) or not key.startswith(prefix) or not key.endswith(".tar.gz.age"):
            continue
        if not isinstance(modified, str):
            raise ValueError(f"R2 object has no LastModified value: {key}")
        backups.append((datetime.fromisoformat(modified.replace("Z", "+00:00")), key))

    if not any(key == protected_key for _, key in backups):
        raise ValueError("The newly uploaded backup is missing from the R2 object listing")
    backups.sort(key=lambda backup: (backup[0], backup[1]), reverse=True)
    return [key for _, key in backups[keep:]]


def main() -> None:
    parser = argparse.ArgumentParser(description="List old verified backups for retention cleanup.")
    parser.add_argument("--listing", required=True, type=Path)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--protected-key", required=True)
    parser.add_argument("--keep", type=int, default=30)
    args = parser.parse_args()
    if args.keep < 1:
        parser.error("--keep must be at least 1")
    response = json.loads(args.listing.read_text(encoding="utf-8"))
    for key in expired_backup_keys(response, args.prefix, args.protected_key, args.keep):
        print(key)


if __name__ == "__main__":
    main()
