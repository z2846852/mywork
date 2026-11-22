#!/usr/bin/env python3
"""Build an honest version-by-version change index using Git release tags.

Reports actual commit subjects, rather than inferring unverified "optimizations".
Build numbers without published tags are intentionally absent.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
TAG_PATTERN = re.compile(r"^v0\.2\.([1-9][0-9]{0,6})$")
MAX_RELEASES = 400
MAX_SUBJECTS = 15
MAX_BYTES = 2 * 1024 * 1024


def git(*args):
    proc = subprocess.run(
        ["git", *args], cwd=ROOT, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return proc.stdout.strip()


def published_tags(current):
    matches = []
    for tag in git("tag", "--list", "v0.2.*").splitlines():
        m = TAG_PATTERN.fullmatch(tag)
        if not m:
            continue
        version = int(m.group(1))
        if version >= current:
            continue
        try:
            git("rev-parse", "--verify", tag + "^{commit}")
        except subprocess.CalledProcessError:
            continue
        matches.append((version, tag))
    matches.sort()
    return matches


def make_record(version, tag, ref, previous):
    base = previous or ""
    subjects = []
    total = 0
    if base:
        interval = base + ".." + ref
        total = int(git("rev-list", "--count", "--no-merges", interval))
        subjects = [
            line.strip()[:180]
            for line in git("log", "--no-merges", f"--max-count={MAX_SUBJECTS}",
                            "--pretty=format:%s", interval).splitlines()
            if line.strip()
        ]
    return {
        "version": version,
        "tag": tag,
        "base": base,
        "sha": git("rev-parse", ref),
        "date": git("show", "-s", "--format=%cI", ref),
        "changes": subjects,
        "more_commits": max(0, total - len(subjects)),
    }


def build(version, sha):
    # Include one preceding tag outside the retained window so the oldest
    # visible release still has an accurate diff against its predecessor.
    published = published_tags(version)
    retained = published[-MAX_RELEASES:]
    predecessor = published[-MAX_RELEASES - 1][1] if len(published) > MAX_RELEASES else ""
    records = []
    previous = predecessor
    for old_version, tag in retained:
        records.append(make_record(old_version, tag, tag, previous))
        previous = tag
    current_tag = f"v0.2.{version}"
    records.append(make_record(version, current_tag, sha, previous))
    records.reverse()
    payload = {
        "schema": 1, "latest_tag": current_tag,
        "source": "git-release-tags-and-commit-subjects",
        "releases": records,
    }
    encoded = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) +
               "\n").encode("utf-8")
    if len(encoded) > MAX_BYTES:
        raise ValueError(f"Release history exceeds size limit: {len(encoded)}")
    (ROOT / "BodyTrace-changelog.json").write_bytes(encoded)

    latest = records[0]
    lines = [
        f"# BodyTrace {current_tag}", "",
        "以下版本变更来自实际 Git 提交标题，自动生成，未经逐项功能验收。",
        f"比较基线：{latest['base'] or '无之前的发布版本'}", "",
    ]
    if latest["changes"]:
        lines.extend("- " + subject for subject in latest["changes"])
        if latest["more_commits"]:
            lines.append(f"- 另有 {latest['more_commits']} 条提交未展开")
    else:
        lines.append("该发布间隔没有可显示的非合并提交标题。")
    lines.extend([
        "", "同时提供签名 APK、可选界面 ZIP 和适用的旧版本差分补丁。",
        "其他已发布版本的逐版历史见附件 BodyTrace-changelog.json。", "",
    ])
    (ROOT / "build").mkdir(exist_ok=True)
    (ROOT / "build/release-notes.md").write_text(
        "\n".join(lines), encoding="utf-8")
    print(f"Release-history index: {len(records)} releases, {len(encoded)} bytes")
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", type=int, required=True)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    if args.version <= 0 or not re.fullmatch("[0-9a-f]{40}", args.commit):
        parser.error("Invalid build version or commit SHA")
    build(args.version, args.commit)
