#!/usr/bin/env python3
"""CI contract test for the generated release-history index and Markdown notes."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--version", required=True, type=int)
args = parser.parse_args()

payload = json.loads((ROOT / "BodyTrace-changelog.json").read_text(encoding="utf-8"))
records = payload["releases"]
assert payload["schema"] == 1 and payload["latest_tag"] == f"v0.2.{args.version}"
assert 1 <= len(records) <= 401
assert records[0]["version"] == args.version
versions = [r["version"] for r in records]
assert versions == sorted(set(versions), reverse=True)
for i, record in enumerate(records):
    assert record["tag"] == f'v0.2.{record["version"]}'
    assert len(record["sha"]) == 40
    assert isinstance(record["changes"], list) and len(record["changes"]) <= 15
    assert all(isinstance(value, str) and 0 < len(value) <= 180
               for value in record["changes"])
    assert isinstance(record["more_commits"], int) and record["more_commits"] >= 0
    if i < len(records) - 1:
        assert record["base"] == records[i + 1]["tag"]
assert (ROOT / "build/release-notes.md").read_text(encoding="utf-8").startswith(
    f"# BodyTrace v0.2.{args.version}")
print(f"Release history validation passed: {len(records)} published versions")
