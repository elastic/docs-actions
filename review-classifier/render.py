#!/usr/bin/env python3

# Licensed to Elasticsearch B.V under one or more agreements.
# Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
# See the LICENSE file in the project root for more information

"""
Validate a review classification decision and render the PR comment.

This script is the security boundary between the classification artifact,
which a fork pull request can influence, and the comment workflow, which has
write access. It validates decision.json against a strict schema. It builds all
comment text from fixed templates, and it inserts only sanitized file paths and
numbers.
"""

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vale", "report"))

from render_report import sanitize_path, sanitize_text, validate as validate_vale  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from classify import load_config  # noqa: E402


MARKER = "<!-- docs-review-classifier -->"
SCHEMA_VERSION = 1
MAX_FILE_SIZE = 1024 * 1024
MAX_REASONS = 500
MAX_PATH_LEN = 256
MAX_LISTED_REASONS = 20
TIERS = frozenset({"skip", "light", "full"})
SHA_RE = re.compile(r"^[0-9a-f]{40}$")

# Trigger id -> (comment label template, short name for override notes).
TRIGGERS = {
    "new-page": ("New page created: {file}", "new page"),
    "page-deleted": ("Page deleted: {file}", "page deleted"),
    "redirect-added": ("Redirect added in {file}", "redirect added"),
    "large-scope": ("Large scope: {value} files changed", "large scope"),
    "images-changed": ("Images changed: {value} files", "images changed"),
    "shared-snippet": ("Shared snippet modified: {file}", "shared snippet modified"),
    "substantial-change": ("Substantial change to existing page: {file} ({detail})", "substantial page change"),
    "applies-to-modified": ("`applies_to` tag modified in {file}", "applies_to modified"),
    "external-link-added": ("External link added in {file}", "external link added"),
}
FILE_TRIGGERS = frozenset(TRIGGERS) - {"large-scope", "images-changed"}
DETAILS = frozenset({None, "headings", "lines"})


# --- validation --------------------------------------------------------------


def _is_int(value, minimum=0, maximum=10**9):
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum


def _is_path(value):
    return isinstance(value, str) and 0 < len(value) <= MAX_PATH_LEN and "\n" not in value


def custom_rules(config):
    return {rule["id"]: rule for rule in config["custom"]}


def validate_decision(data, config):
    """Return a list of schema errors. An empty list means the decision is valid."""
    light_label, full_label = config["light_label"], config["full_label"]
    custom = custom_rules(config)
    if not isinstance(data, dict):
        return ["root must be an object"]
    expected = {
        "schema_version", "pr_number", "head_sha", "dry_run", "tier", "computed_tier",
        "override", "reasons", "bot_labels",
    }
    if set(data) != expected:
        return [f"keys must be exactly {sorted(expected)}, got {sorted(data)}"]

    errors = []
    if data["schema_version"] != SCHEMA_VERSION:
        errors.append(f"unsupported schema_version {data['schema_version']!r}")
    if not _is_int(data["pr_number"], 1):
        errors.append("pr_number must be a positive integer")
    if not isinstance(data["head_sha"], str) or not SHA_RE.match(data["head_sha"]):
        errors.append("head_sha must be a 40-character hex SHA")
    if not isinstance(data["dry_run"], bool):
        errors.append("dry_run must be a boolean")
    if data["tier"] not in TIERS or data["computed_tier"] not in TIERS:
        errors.append("tier and computed_tier must be skip, light, or full")
    if data["override"] not in (None, light_label, full_label):
        errors.append("override must be null or a configured review label")
    if not isinstance(data["bot_labels"], list) or any(l not in (light_label, full_label) for l in data["bot_labels"]):
        errors.append("bot_labels must only contain configured review labels")

    reasons = data["reasons"]
    if not isinstance(reasons, list) or len(reasons) > MAX_REASONS:
        errors.append(f"reasons must be a list of at most {MAX_REASONS} items")
    else:
        for i, item in enumerate(reasons):
            prefix = f"reasons[{i}]"
            if not isinstance(item, dict) or set(item) != {"id", "file", "value", "detail"}:
                errors.append(f"{prefix} must have exactly id, file, value, detail")
                continue
            if not isinstance(item["id"], str):
                errors.append(f"{prefix}.id must be a string")
                continue
            is_custom = item["id"].startswith("custom:")
            if not (item["id"] in TRIGGERS or (is_custom and item["id"][len("custom:"):] in custom)):
                errors.append(f"{prefix}.id is not a known trigger")
                continue
            takes_file = is_custom or item["id"] in FILE_TRIGGERS
            if takes_file and not _is_path(item["file"]):
                errors.append(f"{prefix}.file must be a path")
            if not takes_file and item["file"] is not None:
                errors.append(f"{prefix}.file must be null")
            if item["value"] is not None and not _is_int(item["value"]):
                errors.append(f"{prefix}.value must be null or a non-negative integer")
            if item["detail"] not in DETAILS:
                errors.append(f"{prefix}.detail is not allowed")

    return errors


def load_json_file(path):
    if os.path.islink(path):
        raise ValueError(f"{path} must not be a symlink")
    if os.path.getsize(path) > MAX_FILE_SIZE:
        raise ValueError(f"{path} is larger than {MAX_FILE_SIZE} bytes")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


# --- rendering ---------------------------------------------------------------


def code_path(path):
    return "`" + sanitize_path(path).replace("`", "") + "`"


def reason_text(item, config):
    if item["id"].startswith("custom:"):
        label = custom_rules(config)[item["id"][len("custom:"):]]["label"]
        return f"{sanitize_text(label)}: {code_path(item['file'])}"
    template, _ = TRIGGERS[item["id"]]
    detail = ""
    if item["id"] == "substantial-change":
        detail = "headings changed" if item["detail"] == "headings" else f"{item['value']}% of lines changed"
    return template.format(
        file=code_path(item["file"]) if item["file"] else "",
        value=item["value"] if item["value"] is not None else "",
        detail=detail,
    )


def short_names(reasons, config):
    names = []
    for item in reasons:
        if item["id"].startswith("custom:"):
            name = sanitize_text(custom_rules(config)[item["id"][len("custom:"):]]["label"])
        else:
            name = TRIGGERS[item["id"]][1]
        if name not in names:
            names.append(name)
    return ", ".join(names)


def _plural(count, word):
    return f"{count} {word}{'' if count == 1 else 's'}"


def render_vale(vale, max_findings, run_url):
    # vale/lint already keeps only the issues on changed lines.
    issues = vale["issues"]
    counts = {s: sum(1 for i in issues if i["severity"] == s) for s in ("error", "warning", "suggestion")}
    if not issues:
        return ["✓ Vale: no issues found on changed lines. Language and style were checked automatically."]
    lines = [
        "**Vale** found issues on changed lines. Confirm or dismiss them before you approve: "
        f"{_plural(counts['error'], 'error')} (language), "
        f"{_plural(counts['warning'], 'warning')} and {_plural(counts['suggestion'], 'suggestion')} (style).",
        "",
    ]
    listed = [i for i in issues if i["severity"] in ("error", "warning")]
    listed.sort(key=lambda i: (i["severity"] != "error", i["path"], i["line"]))
    for issue in listed[:max_findings]:
        rule = re.sub(r"[^A-Za-z0-9_.]", "", issue["rule"])
        lines.append(
            f"- {code_path(issue['path'] + ':' + str(issue['line']))}: "
            f"[{issue['severity']}] {sanitize_text(issue['message'])} (`{rule}`)"
        )
    remaining = len(issues) - min(len(listed), max_findings)
    if remaining > 0:
        more = f"{remaining} more"
        lines.append(f"- …and {more}. See the [full Vale results]({run_url})." if run_url else f"- …and {more}.")
    return lines


def render_comment(decision, config, vale=None, run_url=""):
    tier, computed, reasons = decision["tier"], decision["computed_tier"], decision["reasons"]
    light_url, full_url = config["light_url"], config["full_url"]
    lines = [MARKER]
    note = ""
    if decision["override"]:
        if tier == "light" and computed == "full":
            note = f" *(manually overridden — full review was triggered by: {short_names(reasons, config)})*"
        else:
            note = " *(manually overridden)*"

    if tier == "full":
        if reasons and not note:
            lines.append("**Full review required** Triggered by:")
        else:
            lines.append(f"**Full review required**{note}")
            if reasons:
                lines.append("")
                lines.append("Triggered by:")
        shown = reasons[:MAX_LISTED_REASONS]
        lines.extend(f"- {reason_text(item, config)}" for item in shown)
        if len(reasons) > MAX_LISTED_REASONS:
            lines.append("")
            lines.append("<details><summary>More triggers</summary>")
            lines.append("")
            lines.extend(f"- {reason_text(item, config)}" for item in reasons[MAX_LISTED_REASONS:])
            lines.append("")
            lines.append("</details>")
        lines.append("")
        lines.append(f"Use the [full review checklist]({full_url}).")
    else:
        lines.append(
            f"**Light review**{note} This PR qualifies for a light review. "
            f"Use the [light review checklist]({light_url})."
        )

    if vale is not None:
        lines.append("")
        lines.extend(render_vale(vale, config["vale_max_findings"], run_url))
    return "\n".join(lines) + "\n"


def label_plan(decision, config):
    """Describe the label changes the comment workflow would make."""
    light_label, full_label = config["light_label"], config["full_label"]
    if decision["tier"] == "skip":
        return [], list(decision["bot_labels"])
    want = full_label if decision["tier"] == "full" else light_label
    other = light_label if want == full_label else full_label
    return [want], [other]


def render_preview(decision, config):
    add, remove = label_plan(decision, config)
    mode = "dry run: no comment or labels are posted" if decision["dry_run"] else "the comment workflow posts this"
    lines = [
        f"## Review classification for #{decision['pr_number']}",
        "",
        f"- Tier: **{decision['tier']}** (rules: {decision['computed_tier']}; mode: {mode})",
        f"- Labels to add, if missing: {', '.join(f'`{l}`' for l in add) or 'none'}",
        f"- Labels to remove, if present: {', '.join(f'`{l}`' for l in remove) or 'none'}",
        "",
    ]
    if decision["tier"] == "skip":
        lines.append("Only skip-listed files changed, so the workflow posts no comment.")
    else:
        lines.append("### Comment preview")
        lines.append("")
        lines.append(render_comment(decision, config).replace(MARKER + "\n", ""))
        lines.append("Vale findings appear in the Vale summary of this job, when Vale runs.")
    return "\n".join(lines) + "\n"


# --- CLI ---------------------------------------------------------------------


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--decision", required=True)
    parser.add_argument("--vale", help="Path to vale_results.json, if Vale ran")
    parser.add_argument("--output", required=True)
    parser.add_argument("--meta", help="Write validated routing fields to this JSON file")
    parser.add_argument("--preview", action="store_true", help="Render a job summary preview")
    parser.add_argument("--config", help="The caller's config file, converted to JSON. Defaults apply when it is missing.")
    parser.add_argument("--run-url", default="")
    args = parser.parse_args(argv)

    try:
        raw_config = load_json_file(args.config) if args.config and os.path.exists(args.config) else None
        config = load_config(raw_config)
    except (OSError, ValueError) as exc:
        print(f"::error::Invalid review classifier config: {exc}", file=sys.stderr)
        return 1

    try:
        decision = load_json_file(args.decision)
    except (OSError, ValueError) as exc:
        print(f"::error::Cannot read decision: {exc}", file=sys.stderr)
        return 1
    errors = validate_decision(decision, config)
    if errors:
        for error in errors:
            print(f"::error::Invalid decision: {error}", file=sys.stderr)
        return 1

    vale = None
    if args.vale and os.path.exists(args.vale):
        try:
            vale = load_json_file(args.vale)
        except (OSError, ValueError) as exc:
            print(f"::warning::Ignoring Vale results: {exc}", file=sys.stderr)
        else:
            vale_errors = validate_vale(vale)
            if vale_errors:
                print(f"::warning::Ignoring invalid Vale results: {vale_errors[0]}", file=sys.stderr)
                vale = None

    if args.preview:
        body = render_preview(decision, config)
    else:
        body = render_comment(decision, config, vale, args.run_url)

    with open(args.output, "w", encoding="utf-8") as handle:
        handle.write(body)
    if args.meta:
        meta = {k: decision[k] for k in ("pr_number", "head_sha", "dry_run", "tier", "bot_labels")}
        meta["light_label"] = config["light_label"]
        meta["full_label"] = config["full_label"]
        with open(args.meta, "w", encoding="utf-8") as handle:
            json.dump(meta, handle)
    return 0


if __name__ == "__main__":
    sys.exit(main())
