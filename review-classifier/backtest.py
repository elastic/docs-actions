#!/usr/bin/env python3

# Licensed to Elasticsearch B.V under one or more agreements.
# Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
# See the LICENSE file in the project root for more information

"""
Run the review classifier against recently merged pull requests.

Use this to check trigger rates before you change defaults. It needs a local
clone of the target repository that contains the merge commits, and the gh
CLI. For each merged PR, the head is the merge commit and the base is its first
parent, so the diff matches the squashed change.

Example:

    git -C ../docs-content fetch origin main
    python3 backtest.py --repo elastic/docs-content --repo-root ../docs-content --limit 200 \
      --config ../docs-content/.github/review-classifier.yml
"""

import argparse
import json
import shutil
import subprocess
import sys
from collections import Counter

import classify


VARIANTS = {
    "config": {},
    "headings=false": {"headings": False},
    "snippet-scope=directory": {"snippet_scope": "directory"},
    "pages-exclude-snippets=false": {"pages_exclude_snippets": False},
}


def read_config(path):
    """Read the caller config with yq, the same tool that the workflow uses, or PyYAML."""
    if not path:
        return classify.load_config(None)
    if path.endswith((".yml", ".yaml")):
        if shutil.which("yq"):
            out = subprocess.run(["yq", "-o=json", ".", path], check=True, stdout=subprocess.PIPE).stdout
            return classify.load_config(json.loads(out))
        import yaml  # Local fallback when yq is not installed.
        with open(path, encoding="utf-8") as handle:
            return classify.load_config(yaml.safe_load(handle))
    with open(path, encoding="utf-8") as handle:
        return classify.load_config(json.load(handle))


def merged_prs(repo, limit, include_bots):
    out = subprocess.run(
        ["gh", "pr", "list", "--repo", repo, "--state", "merged", "--limit", str(limit),
         "--json", "number,mergeCommit,author"],
        check=True, stdout=subprocess.PIPE,
    ).stdout
    prs = json.loads(out)
    if not include_bots:
        prs = [p for p in prs if not (p.get("author") or {}).get("is_bot")]
    return [p for p in prs if p.get("mergeCommit")]


def changed_files(repo_root, base, head):
    out = subprocess.run(
        ["git", "-C", repo_root, "diff", "--name-status", "-M", "-z", base, head],
        check=True, stdout=subprocess.PIPE,
    ).stdout.decode("utf-8", "replace").split("\0")
    files, i = [], 0
    while i < len(out) and out[i]:
        status = out[i]
        if status[0] in "RC":
            files.append({"status": status, "previous_filename": out[i + 1], "filename": out[i + 2]})
            i += 3
        else:
            files.append({"status": status, "filename": out[i + 1]})
            i += 2
    return files


def has_commit(repo_root, rev):
    return subprocess.run(
        ["git", "-C", repo_root, "cat-file", "-e", f"{rev}^{{commit}}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Backtest the review classifier on merged PRs.")
    parser.add_argument("--repo", required=True, help="owner/name on GitHub")
    parser.add_argument("--repo-root", required=True, help="Local clone that contains the merge commits")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--include-bots", action="store_true")
    parser.add_argument("--config", help="The caller's .github/review-classifier.yml, or the same content as JSON")
    parser.add_argument("--json", help="Write per-PR results to this file")
    args = parser.parse_args(argv)

    base_config = read_config(args.config)
    reader = classify.GitReader(args.repo_root)
    tiers = {name: Counter() for name in VARIANTS}
    triggers = {name: Counter() for name in VARIANTS}
    rows, missing = [], 0
    try:
        prs = merged_prs(args.repo, args.limit, args.include_bots)
        for pr in prs:
            head = pr["mergeCommit"]["oid"]
            if not has_commit(args.repo_root, head):
                missing += 1
                continue
            base = f"{head}^1"
            files = changed_files(args.repo_root, base, head)
            row = {"number": pr["number"]}
            for name, overrides in VARIANTS.items():
                config = dict(base_config, **overrides)
                decision = classify.classify(
                    files,
                    read_base=lambda p: reader.read(base, p),
                    read_head=lambda p: reader.read(head, p),
                    list_head_files=lambda: reader.list_files(head),
                    config=config,
                )
                tiers[name][decision["tier"]] += 1
                for trigger in {r["id"] for r in decision["reasons"]}:
                    triggers[name][trigger] += 1
                row[name] = {"tier": decision["tier"], "reasons": decision["reasons"]}
            rows.append(row)
    finally:
        reader.close()

    total = len(rows)
    print(f"Classified {total} merged PRs from {args.repo}" + (f" ({missing} merge commits not in the clone)" if missing else ""))
    if not total:
        return 1
    names = list(VARIANTS)
    print()
    print("| Result | " + " | ".join(names) + " |")
    print("| --- | " + " | ".join("---" for _ in names) + " |")

    def cell(count):
        return f"{count} ({100 * count / total:.0f}%)"

    for tier in ("skip", "light", "full"):
        print(f"| Tier: {tier} | " + " | ".join(cell(tiers[n][tier]) for n in names) + " |")
    for trigger in classify.TRIGGER_IDS:
        print(f"| {trigger} | " + " | ".join(cell(triggers[n][trigger]) for n in names) + " |")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(rows, handle, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
