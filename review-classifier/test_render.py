#!/usr/bin/env python3

# Licensed to Elasticsearch B.V under one or more agreements.
# Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
# See the LICENSE file in the project root for more information

"""Tests for render.py."""

import copy
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import render  # noqa: E402

LIGHT_URL = "https://example.test/checklists#light-review-checklist"
FULL_URL = "https://example.test/checklists#full-review-checklist"
LIGHT, FULL = "review: light", "review: full"


def decision(**overrides):
    base = {
        "schema_version": 1,
        "pr_number": 12,
        "head_sha": "a" * 40,
        "dry_run": False,
        "tier": "light",
        "computed_tier": "light",
        "override": None,
        "reasons": [],
        "bot_labels": [],
        "changed_lines": {},
    }
    base.update(overrides)
    return base


def reason(trigger_id, file=None, value=None, detail=None):
    return {"id": trigger_id, "file": file, "value": value, "detail": detail}


FULL_REASONS = [
    reason("new-page", "a/new.md"),
    reason("large-scope", None, 7),
    reason("substantial-change", "a/p.md", 34, "lines"),
    reason("substantial-change", "a/q.md", 3, "headings"),
    reason("applies-to-modified", "a/p.md"),
]


class ValidateTests(unittest.TestCase):
    def valid(self, data):
        return render.validate_decision(data, LIGHT, FULL)

    def test_valid_decisions(self):
        self.assertEqual(self.valid(decision()), [])
        full = decision(tier="full", computed_tier="full", reasons=FULL_REASONS,
                        bot_labels=[LIGHT], changed_lines={"a/p.md": [[1, 3]]})
        self.assertEqual(self.valid(full), [])

    def test_rejects_bad_shapes(self):
        bad = [
            decision(extra=1),
            decision(schema_version=2),
            decision(pr_number=0),
            decision(pr_number=True),
            decision(head_sha="main"),
            decision(tier="none"),
            decision(override="admin"),
            decision(bot_labels=["bug"]),
            decision(reasons=[reason("run-script", "x.md")]),
            decision(reasons=[reason("new-page", None)]),
            decision(reasons=[reason("large-scope", "x.md", 3)]),
            decision(reasons=[reason("new-page", "x.md", detail="<b>")]),
            decision(reasons=[{"id": "new-page", "file": "x.md"}]),
            decision(changed_lines={"x.md": [[1]]}),
            decision(changed_lines={"x.md": "1-3"}),
            [],
        ]
        for data in bad:
            with self.subTest(data=data):
                self.assertNotEqual(self.valid(data), [])


class RenderTests(unittest.TestCase):
    def test_light_comment_text(self):
        body = render.render_comment(decision(), LIGHT_URL, FULL_URL)
        self.assertEqual(body, (
            f"{render.MARKER}\n"
            f"**Light review** This PR qualifies for a light review. Use the [light review checklist]({LIGHT_URL}).\n"
        ))

    def test_full_comment_text(self):
        body = render.render_comment(
            decision(tier="full", computed_tier="full", reasons=FULL_REASONS), LIGHT_URL, FULL_URL)
        self.assertEqual(body, "\n".join([
            render.MARKER,
            "**Full review required** Triggered by:",
            "- New page created: `a/new.md`",
            "- Large scope: 7 files changed",
            "- Substantial change to existing page: `a/p.md` (34% of lines changed)",
            "- Substantial change to existing page: `a/q.md` (headings changed)",
            "- `applies_to` tag modified in `a/p.md`",
            "",
            f"Use the [full review checklist]({FULL_URL}).",
            "",
        ]))

    def test_light_override_names_the_triggers(self):
        data = decision(tier="light", computed_tier="full", override=LIGHT, reasons=FULL_REASONS)
        body = render.render_comment(data, LIGHT_URL, FULL_URL)
        self.assertIn(
            "**Light review** *(manually overridden — full review was triggered by: new page, large scope, "
            "substantial page change, applies_to modified)*", body)

    def test_full_override(self):
        data = decision(tier="full", computed_tier="light", override=FULL)
        body = render.render_comment(data, LIGHT_URL, FULL_URL)
        self.assertIn("**Full review required** *(manually overridden)*", body)
        self.assertIn(FULL_URL, body)

    def test_many_reasons_are_collapsed(self):
        reasons = [reason("new-page", f"p{i}.md") for i in range(25)]
        body = render.render_comment(decision(tier="full", computed_tier="full", reasons=reasons), LIGHT_URL, FULL_URL)
        self.assertIn("<details><summary>More triggers</summary>", body)
        self.assertEqual(body.count("- New page created"), 25)

    def test_paths_are_sanitized(self):
        reasons = [reason("new-page", "a/`[x](https://evil)`<img>.md")]
        body = render.render_comment(decision(tier="full", computed_tier="full", reasons=reasons), LIGHT_URL, FULL_URL)
        self.assertNotIn("<img>", body)
        self.assertNotIn("](https://evil)", body)
        self.assertIn("- New page created: `a/xhttps://evil.md`", body)


class ValeTests(unittest.TestCase):
    VALE = {
        "summary": {"errors": 1, "warnings": 2, "suggestions": 1},
        "issues": [
            {"path": "a/p.md", "line": 3, "rule": "Elastic.Latinisms", "severity": "error", "message": "Use 'for example'."},
            {"path": "a/p.md", "line": 40, "rule": "Elastic.WordChoice", "severity": "warning", "message": "Old line."},
            {"path": "a/p.md", "line": 5, "rule": "Elastic.WordChoice", "severity": "warning", "message": "Avoid 'utilize'."},
            {"path": "a/p.md", "line": 5, "rule": "Elastic.Wordiness", "severity": "suggestion", "message": "Wordy."},
        ],
    }

    def test_filters_to_changed_lines_and_lists_findings(self):
        data = decision(changed_lines={"a/p.md": [[1, 10]]})
        body = render.render_comment(data, LIGHT_URL, FULL_URL, vale=self.VALE, max_findings=10, run_url="https://run")
        self.assertIn("1 error (language), 1 warning and 1 suggestion (style)", body)
        self.assertIn("- `a/p.md:3`: [error] Use 'for example'. (`Elastic.Latinisms`)", body)
        self.assertNotIn("Old line", body)
        self.assertIn("…and 1 more. See the [full Vale results](https://run).", body)

    def test_dot_slash_paths_match_changed_lines(self):
        vale = copy.deepcopy(self.VALE)
        for issue in vale["issues"]:
            issue["path"] = "./" + issue["path"]
        data = decision(changed_lines={"a/p.md": [[1, 10]]})
        body = render.render_comment(data, LIGHT_URL, FULL_URL, vale=vale)
        self.assertNotIn("Old line", body)

    def test_cap(self):
        data = decision(changed_lines={"a/p.md": [[1, 10]]})
        body = render.render_comment(data, LIGHT_URL, FULL_URL, vale=self.VALE, max_findings=1)
        self.assertNotIn("utilize", body)
        self.assertIn("…and 2 more.", body)

    def test_no_findings(self):
        data = decision(changed_lines={"a/p.md": [[100, 110]]})
        body = render.render_comment(data, LIGHT_URL, FULL_URL, vale=self.VALE)
        self.assertIn("✓ Vale: no issues found on changed lines.", body)


class PreviewAndCliTests(unittest.TestCase):
    def test_preview(self):
        data = decision(tier="full", computed_tier="full", reasons=FULL_REASONS, dry_run=True, bot_labels=[LIGHT])
        body = render.render_preview(data, LIGHT_URL, FULL_URL, LIGHT, FULL)
        self.assertIn("Tier: **full**", body)
        self.assertIn("dry run: no comment or labels are posted", body)
        self.assertIn("Labels to add, if missing: `review: full`", body)
        self.assertIn("Labels to remove, if present: `review: light`", body)
        self.assertNotIn(render.MARKER, body)

    def test_label_plan_for_skip_only_removes_bot_labels(self):
        self.assertEqual(render.label_plan(decision(tier="skip", computed_tier="skip", bot_labels=[FULL]), LIGHT, FULL),
                         ([], [FULL]))

    def test_cli_rejects_invalid_and_writes_meta(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "decision.json")
            out = os.path.join(tmp, "comment.md")
            meta = os.path.join(tmp, "meta.json")
            args = ["--decision", path, "--output", out, "--meta", meta, "--light-url", LIGHT_URL, "--full-url", FULL_URL]

            with open(path, "w") as f:
                json.dump(decision(tier="bogus"), f)
            self.assertEqual(render.main(args), 1)

            with open(path, "w") as f:
                json.dump(decision(), f)
            self.assertEqual(render.main(args), 0)
            with open(meta) as f:
                self.assertEqual(json.load(f)["pr_number"], 12)

            link = os.path.join(tmp, "link.json")
            os.symlink(path, link)
            self.assertEqual(render.main(["--decision", link] + args[2:]), 1)

    def test_cli_ignores_invalid_vale(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "decision.json")
            vale = os.path.join(tmp, "vale_results.json")
            out = os.path.join(tmp, "comment.md")
            with open(path, "w") as f:
                json.dump(decision(), f)
            bad = copy.deepcopy(ValeTests.VALE)
            bad["issues"][0]["severity"] = "fatal"
            with open(vale, "w") as f:
                json.dump(bad, f)
            self.assertEqual(render.main(["--decision", path, "--vale", vale, "--output", out,
                                          "--light-url", LIGHT_URL, "--full-url", FULL_URL]), 0)
            with open(out) as f:
                self.assertNotIn("Vale", f.read())


if __name__ == "__main__":
    unittest.main()
