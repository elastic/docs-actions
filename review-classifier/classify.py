#!/usr/bin/env python3

# Licensed to Elasticsearch B.V under one or more agreements.
# Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
# See the LICENSE file in the project root for more information

"""
Classify a docs pull request as light review or full review.

The classifier is deterministic. It reads the list of changed files, the base
and head versions of those files from git, and the review labels on the pull
request. It writes a decision JSON file that the comment workflow validates and
renders. It never runs code from the pull request.

The rules follow elastic/docs-content-internal#1943.
"""

import argparse
import difflib
import json
import os
import posixpath
import re
import subprocess
import sys
from collections import Counter, deque
from urllib.parse import urlsplit


SCHEMA_VERSION = 1
BOT_LOGIN = "github-actions[bot]"

TRIGGER_IDS = (
    "new-page",
    "page-deleted",
    "redirect-added",
    "large-scope",
    "images-changed",
    "shared-snippet",
    "substantial-change",
    "applies-to-modified",
    "external-link-added",
)

BUILTIN_SKIP_PATHS = (".github/**", "**/*.csv")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")
DOCSET_FILES = ("docset.yml", "_docset.yml")
CODE_DIRECTIVES = frozenset({"code", "code-block", "sourcecode"})

# Bound the artifact so that very large PRs do not produce huge decisions.
MAX_CHANGED_LINE_FILES = 300
MAX_RANGES_PER_FILE = 500

DEFAULT_CONFIG = {
    "skip_paths": list(BUILTIN_SKIP_PATHS),
    "snippet_patterns": ["**/_snippets/**", "**/snippets/**"],
    "redirect_files": ["**/redirects.yml", "**/_redirects"],
    "max_files": 5,
    "min_images": 3,
    # (max base lines, percent). None is the fallback for larger pages.
    "size_thresholds": [(199, 20), (500, 10), (None, 5)],
    "allowed_link_hosts": ["elastic.co", "*.elastic.co", "github.com/elastic"],
    "snippet_scope": "top-level",
    "pages_exclude_snippets": True,
    "light_label": "review: light",
    "full_label": "review: full",
}


# --- configuration -----------------------------------------------------------


def split_list(value):
    """Split a space- or newline-separated input into a list."""
    return [item for item in re.split(r"\s+", value or "") if item]


def parse_size_thresholds(value):
    """Parse '199:20,500:10,5' into [(199, 20), (500, 10), (None, 5)]."""
    thresholds = []
    for part in [p.strip() for p in value.split(",") if p.strip()]:
        if ":" in part:
            max_lines, percent = part.split(":", 1)
            thresholds.append((int(max_lines), float(percent)))
        else:
            thresholds.append((None, float(part)))
    if not thresholds or thresholds[-1][0] is not None:
        raise ValueError("size thresholds must end with a fallback percent, for example '199:20,500:10,5'")
    return thresholds


def config_from_env(env):
    """Build the classifier configuration from workflow input environment variables."""
    config = dict(DEFAULT_CONFIG)
    config["skip_paths"] = list(BUILTIN_SKIP_PATHS) + split_list(env.get("SKIP_PATHS", ""))
    if env.get("SNIPPET_PATTERNS", "").strip():
        config["snippet_patterns"] = split_list(env["SNIPPET_PATTERNS"])
    if env.get("REDIRECT_FILES", "").strip():
        config["redirect_files"] = split_list(env["REDIRECT_FILES"])
    if env.get("MAX_FILES", "").strip():
        config["max_files"] = int(env["MAX_FILES"])
    if env.get("MIN_IMAGES", "").strip():
        config["min_images"] = int(env["MIN_IMAGES"])
    if env.get("SIZE_THRESHOLDS", "").strip():
        config["size_thresholds"] = parse_size_thresholds(env["SIZE_THRESHOLDS"])
    if env.get("ALLOWED_LINK_HOSTS", "").strip():
        config["allowed_link_hosts"] = split_list(env["ALLOWED_LINK_HOSTS"])
    if env.get("SNIPPET_SCOPE", "").strip():
        scope = env["SNIPPET_SCOPE"].strip()
        if scope not in ("top-level", "directory"):
            raise ValueError(f"snippet-scope must be 'top-level' or 'directory', got {scope!r}")
        config["snippet_scope"] = scope
    if env.get("PAGES_EXCLUDE_SNIPPETS", "").strip():
        config["pages_exclude_snippets"] = env["PAGES_EXCLUDE_SNIPPETS"].strip().lower() == "true"
    if env.get("LIGHT_LABEL", "").strip():
        config["light_label"] = env["LIGHT_LABEL"].strip()
    if env.get("FULL_LABEL", "").strip():
        config["full_label"] = env["FULL_LABEL"].strip()
    return config


# --- path matching -----------------------------------------------------------


def glob_to_regex(pattern):
    """Translate a glob with ** support into a compiled regex.

    A pattern without a slash matches the file name in any directory.
    """
    if "/" not in pattern:
        pattern = "**/" + pattern
    out = []
    i = 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


class PathMatcher:
    def __init__(self, patterns):
        self.regexes = [glob_to_regex(p) for p in patterns]

    def __call__(self, path):
        return any(r.match(path) for r in self.regexes)


# --- git access --------------------------------------------------------------


class GitReader:
    """Read blobs through one `git cat-file --batch` process."""

    def __init__(self, repo_root):
        self.repo_root = repo_root
        self.proc = subprocess.Popen(
            ["git", "-C", repo_root, "cat-file", "--batch"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
        )

    def read(self, rev, path):
        """Return the file text at rev, or None when the file does not exist."""
        if not path or "\n" in path:
            return None
        self.proc.stdin.write(f"{rev}:{path}\n".encode("utf-8"))
        self.proc.stdin.flush()
        header = self.proc.stdout.readline().decode("utf-8", "replace").rstrip("\n")
        if header.endswith(" missing") or header.endswith(" ambiguous"):
            return None
        parts = header.split()
        if len(parts) != 3:
            raise RuntimeError(f"unexpected git cat-file header: {header!r}")
        size = int(parts[2])
        data = self.proc.stdout.read(size)
        self.proc.stdout.read(1)  # trailing newline
        if parts[1] != "blob":
            return None
        return data.decode("utf-8", "replace")

    def list_files(self, rev):
        out = subprocess.run(
            ["git", "-C", self.repo_root, "ls-tree", "-r", "-z", "--name-only", rev],
            check=True,
            stdout=subprocess.PIPE,
        ).stdout
        return [p for p in out.decode("utf-8", "replace").split("\0") if p]

    def close(self):
        self.proc.stdin.close()
        self.proc.wait()
        self.proc.stdout.close()


# --- Markdown scanning -------------------------------------------------------


FENCE_RE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*(.*)$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
INLINE_APPLIES_RE = re.compile(r"\{applies_to\}`([^`]*)`")
DIRECTIVE_APPLIES_RE = re.compile(r"^\s*:applies_to:\s*(.*)$")
INCLUDE_RE = re.compile(r"^\s*(?::{3,}|`{3,})\{include\}\s+(\S+)")
URL_RE = re.compile(r"https?://[^\s<>()\[\]\"'`]+")
INLINE_CODE_RE = re.compile(r"`[^`]*`")
# vale/lint inserts its file list into a shell script, so only pass plain paths.
SAFE_PATH_RE = re.compile(r"^[A-Za-z0-9._/@+-]+$")


class Scan:
    def __init__(self):
        self.frontmatter = []
        self.prose = []
        self.applies_blocks = []


def scan_markdown(text):
    """Split a page into frontmatter, prose lines, and fenced applies_to blocks.

    Lines inside code fences are dropped. MyST directive fences, such as
    ```{note}, contain prose, so their lines stay in the prose list.
    """
    result = Scan()
    lines = text.splitlines()
    start = 0
    if lines and lines[0].strip() == "---":
        for idx in range(1, len(lines)):
            if lines[idx].strip() in ("---", "..."):
                result.frontmatter = lines[1:idx]
                start = idx + 1
                break

    stack = []  # [char, length, kind, buffer]
    for idx in range(start, len(lines)):
        line = lines[idx]
        match = FENCE_RE.match(line)
        if stack and stack[-1][2] in ("code", "applies"):
            top = stack[-1]
            if match and match.group(2)[0] == top[0] and len(match.group(2)) >= top[1] and not match.group(3).strip():
                stack.pop()
                if top[2] == "applies":
                    result.applies_blocks.append(top[3])
            elif top[2] == "applies":
                top[3].append(line)
            continue
        if match:
            fence, info = match.group(2), match.group(3).strip()
            if stack and not info and fence[0] == stack[-1][0] and len(fence) >= stack[-1][1]:
                stack.pop()
                continue
            kind = "code"
            if info.startswith("{") and "}" in info:
                name = info[1:info.index("}")]
                if name == "applies_to":
                    kind = "applies"
                elif name not in CODE_DIRECTIVES:
                    kind = "directive"
            stack.append([fence[0], len(fence), kind, []])
            continue
        result.prose.append((idx + 1, line))
    return result


def normalize_ws(text):
    return " ".join(text.split())


def extract_headings(scan):
    headings = Counter()
    for _, line in scan.prose:
        match = HEADING_RE.match(line)
        if match:
            headings[f"{len(match.group(1))} {normalize_ws(match.group(2))}"] += 1
    return headings


# --- minimal YAML for applies_to values ---------------------------------------


def _join(prefix, key):
    return f"{prefix}.{key}" if prefix else key


def _clean_scalar(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    return normalize_ws(value)


def _split_top_level(text, sep=","):
    parts, depth, current = [], 0, []
    for char in text:
        if char in "{[":
            depth += 1
        elif char in "}]":
            depth -= 1
        if char == sep and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return parts


def flow_pairs(text, prefix=""):
    """Flatten a YAML flow mapping such as '{ ece: ga, ess: { x: y } }'."""
    text = text.strip()
    if text.startswith("{") and text.endswith("}"):
        text = text[1:-1]
    pairs = []
    for item in _split_top_level(text):
        item = item.strip()
        if not item:
            continue
        key, _, value = item.partition(":")
        path = _join(prefix, _clean_scalar(key))
        value = value.strip()
        if value.startswith("{"):
            nested = flow_pairs(value, path)
            pairs.extend(nested or [(path, "")])
        else:
            pairs.append((path, _clean_scalar(value)))
    return pairs


def block_pairs(lines, prefix=""):
    """Flatten a small YAML block mapping into (dotted.path, value) pairs."""
    pairs = []
    stack = []  # [indent, path, has_children]

    def close_until(indent):
        while stack and stack[-1][0] >= indent:
            entry = stack.pop()
            if not entry[2]:
                pairs.append((entry[1], ""))

    for raw in lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        content = re.sub(r"\s+#.*$", "", stripped)
        if content.startswith("- "):
            content = content[2:].strip()
        close_until(indent)
        parent = stack[-1][1] if stack else prefix
        if stack:
            stack[-1][2] = True
        if ":" not in content:
            pairs.append((parent, _clean_scalar(content)))
            continue
        key, _, value = content.partition(":")
        path = _join(parent, _clean_scalar(key))
        value = value.strip()
        if value.startswith("{"):
            nested = flow_pairs(value, path)
            pairs.extend(nested or [(path, "")])
        elif value:
            pairs.append((path, _clean_scalar(value)))
        else:
            stack.append([indent, path, False])
    close_until(-1)
    return pairs


def value_pairs(text):
    text = text.strip()
    if text.startswith("{"):
        return flow_pairs(text)
    return block_pairs([text])


def frontmatter_applies_lines(frontmatter):
    """Return the lines of the frontmatter applies_to block, or a flow value."""
    for idx, line in enumerate(frontmatter):
        match = re.match(r"^applies_to:\s*(.*)$", line)
        if not match:
            continue
        rest = match.group(1).strip()
        if rest:
            return None, rest
        block = []
        for follow in frontmatter[idx + 1:]:
            if follow.strip() and not follow.startswith((" ", "\t")):
                break
            block.append(follow)
        return block, None
    return None, None


def extract_applies_to(scan):
    """Return a multiset of normalized applies_to pairs, keyed by form."""
    values = Counter()
    block, flow = frontmatter_applies_lines(scan.frontmatter)
    if flow:
        for path, value in value_pairs(flow):
            values[f"frontmatter:{path}={value}"] += 1
    if block:
        for path, value in block_pairs(block):
            values[f"frontmatter:{path}={value}"] += 1
    for body in scan.applies_blocks:
        for path, value in block_pairs(body):
            values[f"block:{path}={value}"] += 1
    for _, line in scan.prose:
        for match in INLINE_APPLIES_RE.finditer(line):
            for path, value in value_pairs(match.group(1)):
                values[f"inline:{path}={value}"] += 1
        match = DIRECTIVE_APPLIES_RE.match(line)
        if match:
            for path, value in value_pairs(match.group(1)):
                values[f"directive:{path}={value}"] += 1
    return values


# --- links -------------------------------------------------------------------


def extract_urls(scan):
    urls = Counter()
    for _, line in scan.prose:
        for match in URL_RE.finditer(INLINE_CODE_RE.sub("", line)):
            urls[match.group(0).rstrip(".,;:!?*_")] += 1
    return urls


def _host_matches(host, pattern):
    if pattern.startswith("*."):
        return host.endswith(pattern[1:])
    return host == pattern


def is_allowed_url(url, allowed):
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    path = parts.path.lower()
    for pattern in allowed:
        pattern = pattern.lower()
        if "/" in pattern:
            phost, ppath = pattern.split("/", 1)
            prefix = "/" + ppath.strip("/")
            if _host_matches(host, phost) and (path == prefix or path.startswith(prefix + "/")):
                return True
        elif _host_matches(host, pattern):
            return True
    return False


# --- redirects ---------------------------------------------------------------


REDIRECT_KEY_RE = re.compile(r"""^(['"]?)(.+?)\1\s*:(?:\s|$)""")


def redirect_keys(text, filename):
    """Return the set of redirect source paths in a redirects file."""
    if not text:
        return set()
    lines = text.splitlines()
    if posixpath.basename(filename) == "_redirects":
        keys = set()
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                keys.add(stripped.split()[0])
        return keys

    start, key_indent = None, None
    for idx, line in enumerate(lines):
        if re.match(r"^redirects:\s*$", line):
            start = idx + 1
            break
    if start is None:
        start, key_indent = 0, 0
    keys = set()
    for line in lines[start:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if key_indent is None:
            key_indent = indent
        if start and indent == 0:
            break
        if indent != key_indent:
            continue
        match = REDIRECT_KEY_RE.match(stripped)
        if match:
            keys.add(match.group(2))
    return keys


# --- line changes ------------------------------------------------------------


def line_changes(base, head):
    """Count changed lines, ignoring whitespace changes and rewrapped text.

    Returns (added, deleted, head_ranges). head_ranges lists the head lines
    that changed, as inclusive [start, end] pairs.
    """
    base_lines = [normalize_ws(line) for line in base.splitlines()]
    head_lines = [normalize_ws(line) for line in head.splitlines()]
    matcher = difflib.SequenceMatcher(None, base_lines, head_lines, autojunk=False)
    added = deleted = 0
    ranges = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        old = [line for line in base_lines[i1:i2] if line]
        new = [line for line in head_lines[j1:j2] if line]
        if tag == "replace" and " ".join(old).split() == " ".join(new).split():
            continue
        deleted += len(old)
        added += len(new)
        if new:
            ranges.append([j1 + 1, j2])
    return added, deleted, ranges


def threshold_for(base_line_count, thresholds):
    for max_lines, percent in thresholds:
        if max_lines is None or base_line_count <= max_lines:
            return percent
    return thresholds[-1][1]


# --- snippets ----------------------------------------------------------------


def docset_root_for(path, docset_dirs):
    directory = posixpath.dirname(path)
    while True:
        if directory in docset_dirs:
            return directory
        if not directory:
            return ""
        directory = posixpath.dirname(directory)


def resolve_include(includer, target, docset_root):
    if target.startswith("/"):
        resolved = posixpath.join(docset_root, target.lstrip("/"))
    else:
        resolved = posixpath.join(posixpath.dirname(includer), target)
    resolved = posixpath.normpath(resolved)
    if resolved.startswith("../") or resolved == "..":
        return None
    return resolved


def build_include_graph(files, read):
    """Return {included path: set(includer paths)} for the head tree."""
    docset_dirs = {posixpath.dirname(f) for f in files if posixpath.basename(f) in DOCSET_FILES}
    reverse = {}
    for path in files:
        if not path.endswith(".md"):
            continue
        text = read(path) or ""
        if "{include}" not in text:
            continue
        root = docset_root_for(path, docset_dirs)
        for line in text.splitlines():
            match = INCLUDE_RE.match(line)
            if not match:
                continue
            target = resolve_include(path, match.group(1), root)
            if target:
                reverse.setdefault(target, set()).add(path)
    return reverse, docset_dirs


def folder_key(path, docset_dirs, scope):
    if scope == "directory":
        return posixpath.dirname(path)
    root = docset_root_for(path, docset_dirs)
    rel = path[len(root) + 1:] if root else path
    return rel.split("/", 1)[0] if "/" in rel else "."


def snippet_folders(snippet, reverse, docset_dirs, is_snippet, scope):
    """Return the folders of the pages that include a snippet, directly or not."""
    seen, pages = set(), set()
    queue = deque([snippet])
    while queue:
        current = queue.popleft()
        for includer in reverse.get(current, ()):
            if includer in seen:
                continue
            seen.add(includer)
            queue.append(includer)
            if not is_snippet(includer):
                pages.add(includer)
    users = pages or seen
    return {folder_key(p, docset_dirs, scope) for p in users}


# --- classification ----------------------------------------------------------


def normalize_status(status):
    """Map GitHub API statuses and git --name-status letters to four values."""
    status = (status or "").lower()
    if status in ("added", "copied", "a") or re.fullmatch(r"c\d*", status):
        return "added"
    if status in ("removed", "d"):
        return "removed"
    if status == "renamed" or re.fullmatch(r"r\d*", status):
        return "renamed"
    return "modified"


def normalize_files(raw_files):
    files = []
    for entry in raw_files:
        filename = entry.get("filename")
        if not filename:
            continue
        status = normalize_status(entry.get("status"))
        previous = entry.get("previous_filename") if status == "renamed" else None
        files.append({"filename": filename, "status": status, "previous_filename": previous or None})
    return files


def resolve_labels(labels, label_events, config):
    """Split the review labels on the PR into human-applied and bot-applied."""
    review_labels = (config["full_label"], config["light_label"])
    latest = {}
    for event in label_events:
        name = event.get("label")
        if name in review_labels and event.get("event") in ("labeled", "unlabeled"):
            latest[name] = (event.get("event"), event.get("actor"))
    human, bot = [], []
    for name in review_labels:
        if name not in labels:
            continue
        last = latest.get(name)
        if last and last[0] == "labeled" and last[1] == BOT_LOGIN:
            bot.append(name)
        else:
            human.append(name)
    return human, bot


def reason(trigger_id, file=None, value=None, detail=None):
    return {"id": trigger_id, "file": file, "value": value, "detail": detail}


def classify(files, read_base, read_head, list_head_files, config, labels=(), label_events=()):
    """Classify a change. Returns the decision fields without PR metadata."""
    skip = PathMatcher(config["skip_paths"])
    is_snippet = PathMatcher(config["snippet_patterns"])
    is_redirect_file = PathMatcher(config["redirect_files"])

    files = [f for f in normalize_files(files) if not skip(f["filename"])]
    reasons = []
    changed_lines = {}

    def is_page(path):
        return path.endswith(".md") and not (config["pages_exclude_snippets"] and is_snippet(path))

    # 1 and 2: pages added or deleted.
    for f in files:
        if is_page(f["filename"]) and f["status"] == "added":
            reasons.append(reason("new-page", f["filename"]))
    for f in files:
        if is_page(f["filename"]) and f["status"] == "removed":
            reasons.append(reason("page-deleted", f["filename"]))

    # 3: new redirect keys.
    for f in files:
        if f["status"] == "removed" or not is_redirect_file(f["filename"]):
            continue
        base_path = f["previous_filename"] or f["filename"]
        base_keys = redirect_keys(read_base(base_path) if f["status"] != "added" else "", base_path)
        head_keys = redirect_keys(read_head(f["filename"]), f["filename"])
        if head_keys - base_keys:
            reasons.append(reason("redirect-added", f["filename"], len(head_keys - base_keys)))

    # 4: large scope.
    if len(files) > config["max_files"]:
        reasons.append(reason("large-scope", None, len(files)))

    # 5: images.
    images = [f for f in files if f["filename"].lower().endswith(IMAGE_EXTENSIONS)]
    if len(images) >= config["min_images"]:
        reasons.append(reason("images-changed", None, len(images)))

    # 6: shared snippets used in more than one folder.
    changed_snippets = [
        f["filename"] for f in files
        if f["status"] in ("modified", "renamed") and f["filename"].endswith(".md") and is_snippet(f["filename"])
    ]
    if changed_snippets:
        reverse, docset_dirs = build_include_graph(list_head_files(), read_head)
        for snippet in changed_snippets:
            folders = snippet_folders(snippet, reverse, docset_dirs, is_snippet, config["snippet_scope"])
            if len(folders) > 1:
                reasons.append(reason("shared-snippet", snippet, len(folders)))

    # 7, 8, and 9: per-file content checks.
    for f in files:
        path = f["filename"]
        if not path.endswith(".md") or f["status"] == "removed":
            continue
        head = read_head(path) or ""
        base = ""
        if f["status"] in ("modified", "renamed"):
            base = read_base(f["previous_filename"] or path) or ""
        head_scan = scan_markdown(head)
        base_scan = scan_markdown(base)

        added, deleted, ranges = line_changes(base, head)
        if len(changed_lines) < MAX_CHANGED_LINE_FILES:
            changed_lines[path] = ranges[:MAX_RANGES_PER_FILE]

        if is_page(path) and f["status"] in ("modified", "renamed"):
            base_count = len(base.splitlines())
            percent = round(100 * (added + deleted) / max(base_count, 1))
            if extract_headings(base_scan) != extract_headings(head_scan):
                reasons.append(reason("substantial-change", path, percent, "headings"))
            elif (added + deleted) and 100 * (added + deleted) / max(base_count, 1) >= threshold_for(
                base_count, config["size_thresholds"]
            ):
                reasons.append(reason("substantial-change", path, percent, "lines"))

        if extract_applies_to(base_scan) - extract_applies_to(head_scan):
            reasons.append(reason("applies-to-modified", path))

        new_urls = extract_urls(head_scan) - extract_urls(base_scan)
        external = sorted(u for u in new_urls if not is_allowed_url(u, config["allowed_link_hosts"]))
        if external:
            reasons.append(reason("external-link-added", path, len(external)))

    computed = "skip" if not files else ("full" if reasons else "light")
    human, bot = resolve_labels(set(labels), label_events, config)
    tier, override = computed, None
    if config["full_label"] in human:
        tier = "full"
    elif config["light_label"] in human:
        tier = "light"
    if tier != computed:
        override = config["full_label"] if tier == "full" else config["light_label"]

    vale_files = [f["filename"] for f in files if f["status"] != "removed" and f["filename"].endswith((".md", ".mdx"))]
    return {
        "tier": tier,
        "computed_tier": computed,
        "override": override,
        "reasons": reasons,
        "bot_labels": bot,
        "changed_lines": changed_lines,
    }, vale_files


# --- CLI ---------------------------------------------------------------------


def load_json(path, default):
    if not path:
        return default
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--base-rev", required=True)
    parser.add_argument("--head-rev", default="HEAD")
    parser.add_argument("--files", required=True, help="JSON list of {filename, status, previous_filename}")
    parser.add_argument("--labels", help="JSON list of label names on the PR")
    parser.add_argument("--label-events", help="JSON list of {event, label, actor}")
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--output", required=True)
    parser.add_argument("--vale-files", help="Write the Markdown files to lint, one per line")
    args = parser.parse_args(argv)

    config = config_from_env(os.environ)
    reader = GitReader(args.repo_root)
    try:
        decision, vale_files = classify(
            load_json(args.files, []),
            read_base=lambda p: reader.read(args.base_rev, p),
            read_head=lambda p: reader.read(args.head_rev, p),
            list_head_files=lambda: reader.list_files(args.head_rev),
            config=config,
            labels=load_json(args.labels, []),
            label_events=load_json(args.label_events, []),
        )
    finally:
        reader.close()

    output = {
        "schema_version": SCHEMA_VERSION,
        "pr_number": args.pr_number,
        "head_sha": args.head_sha,
        "dry_run": args.dry_run,
        **decision,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)
        handle.write("\n")
    if args.vale_files:
        with open(args.vale_files, "w", encoding="utf-8") as handle:
            handle.write("".join(f"{p}\n" for p in vale_files if SAFE_PATH_RE.match(p)))

    print(f"Tier: {output['tier']} (computed: {output['computed_tier']}), {len(output['reasons'])} reason(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
