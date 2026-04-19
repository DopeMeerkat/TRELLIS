#!/usr/bin/env python3
from pathlib import Path
import shutil


def clear_directory_contents(directory: Path) -> tuple[int, int]:
    removed = 0
    failed = 0

    if not directory.exists():
        directory.mkdir(parents=True, exist_ok=True)
        return removed, failed

    for item in directory.iterdir():
        try:
            if item.is_dir() and not item.is_symlink():
                shutil.rmtree(item)
            else:
                item.unlink()
            removed += 1
        except Exception:
            failed += 1

    return removed, failed


def main() -> None:
    repo_root = Path(__file__).resolve().parent
    targets = [
        repo_root / "outputs_api",
        repo_root / "webapp" / "data" / "outputs",
        repo_root / "webapp" / "data" / "uploads",
    ]

    total_removed = 0
    total_failed = 0

    for target in targets:
        removed, failed = clear_directory_contents(target)
        total_removed += removed
        total_failed += failed
        print(f"Cleared {target}: removed={removed}, failed={failed}")

    print(f"Done. Total removed={total_removed}, total failed={total_failed}")


if __name__ == "__main__":
    main()
