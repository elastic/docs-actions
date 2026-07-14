#!/usr/bin/env python3

# Licensed to Elasticsearch B.V under one or more agreements.
# Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
# See the LICENSE file in the project root for more information

"""Tests for lint/vale_reporter.py — sanitisation functions."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

# Allow importing the module under test
sys.path.insert(0, os.path.dirname(__file__))
import vale_reporter  # noqa: E402


class TestModifiedLineFiltering(unittest.TestCase):
    """Tests for filtering Vale findings to lines added by a PR."""

    def test_delete_only_file_has_no_modified_lines(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            ranges_file = Path(temp_dir) / "line_ranges.txt"
            ranges_file.write_text("docs/delete-only.md|0|0\n", encoding="utf-8")

            ranges = vale_reporter.load_modified_ranges(str(ranges_file))

        self.assertEqual(ranges, {"docs/delete-only.md": []})

        vale_data = {
            "docs/delete-only.md": [
                {
                    "Line": 12,
                    "Severity": "warning",
                    "Check": "Elastic.WordChoice",
                    "Message": "Unchanged content",
                    "Match": "simple",
                }
            ]
        }
        filtered = vale_reporter.filter_issues_to_modified_lines(vale_data, ranges)

        self.assertEqual(filtered, {"error": [], "warning": [], "suggestion": []})

    def test_added_lines_are_still_reported(self):
        ranges = {"docs/changed.md": [(12, 13)]}
        vale_data = {
            "docs/changed.md": [
                {"Line": 11, "Severity": "warning", "Check": "before"},
                {"Line": 12, "Severity": "warning", "Check": "added"},
                {"Line": 13, "Severity": "warning", "Check": "after"},
            ]
        }

        filtered = vale_reporter.filter_issues_to_modified_lines(vale_data, ranges)

        self.assertEqual([issue["rule"] for issue in filtered["warning"]], ["added"])

    def test_missing_range_data_preserves_whole_file_fallback(self):
        vale_data = {
            "docs/changed.md": [
                {"Line": 12, "Severity": "warning", "Check": "Elastic.WordChoice"}
            ]
        }

        filtered = vale_reporter.filter_issues_to_modified_lines(vale_data, {})

        self.assertEqual(len(filtered["warning"]), 1)


class TestSanitizeAnnotation(unittest.TestCase):
    """Tests for sanitize_annotation() — strips workflow command sequences."""

    def test_strips_double_colon(self):
        self.assertEqual(
            vale_reporter.sanitize_annotation("text ::set-env name=X::Y"),
            "text  set-env name=X Y",
        )

    def test_strips_newlines(self):
        self.assertEqual(
            vale_reporter.sanitize_annotation("line1\nline2\rline3"),
            "line1 line2 line3",
        )

    def test_preserves_normal_text(self):
        msg = "Use 'Elasticsearch' instead of 'elasticsearch'"
        self.assertEqual(vale_reporter.sanitize_annotation(msg), msg)

    def test_coerces_non_string(self):
        self.assertEqual(vale_reporter.sanitize_annotation(42), "42")

    def test_combined_injection(self):
        payload = "bad\n::error::injected message"
        result = vale_reporter.sanitize_annotation(payload)
        self.assertNotIn("::", result)
        self.assertNotIn("\n", result)


class TestSanitizeText(unittest.TestCase):
    """Tests for sanitize_text() — strips HTML, links, and injection chars."""

    def test_strips_html_tags(self):
        self.assertEqual(
            vale_reporter.sanitize_text("<script>alert(1)</script>"),
            "alert1",
        )

    def test_strips_markdown_links(self):
        self.assertEqual(
            vale_reporter.sanitize_text("[click here](https://evil.com)"),
            "click here",
        )

    def test_strips_bare_urls(self):
        self.assertEqual(
            vale_reporter.sanitize_text("visit https://evil.com for info"),
            "visit  for info",
        )

    def test_escapes_pipe(self):
        self.assertEqual(
            vale_reporter.sanitize_text("col1 | col2"),
            "col1 \\| col2",
        )

    def test_preserves_normal_message(self):
        msg = "Use 'Elasticsearch' instead of 'elasticsearch'."
        self.assertEqual(vale_reporter.sanitize_text(msg), msg)


class TestSanitizePath(unittest.TestCase):
    """Tests for sanitize_path() — sanitizes paths while preserving slashes."""

    def test_preserves_normal_path(self):
        self.assertEqual(
            vale_reporter.sanitize_path("docs/guide.md"),
            "docs/guide.md",
        )

    def test_strips_html_in_path(self):
        self.assertEqual(
            vale_reporter.sanitize_path("docs/<img src=x>.md"),
            "docs/.md",
        )

    def test_escapes_pipe_in_path(self):
        self.assertEqual(
            vale_reporter.sanitize_path("docs/a|b.md"),
            "docs/a\\|b.md",
        )

    def test_strips_injection_chars(self):
        self.assertEqual(
            vale_reporter.sanitize_path("docs/[evil](url).md"),
            "docs/evilurl.md",
        )


class TestFormatRuleLink(unittest.TestCase):
    """Tests for format_rule_link() — links only safe Elastic rule IDs."""

    def test_links_elastic_rule(self):
        self.assertEqual(
            vale_reporter.format_rule_link("Elastic.Articles"),
            "[Elastic.Articles](https://github.com/elastic/vale-rules/blob/main/styles/Elastic/Articles.yml)",
        )

    def test_does_not_link_non_elastic_rule(self):
        self.assertEqual(
            vale_reporter.format_rule_link("Vale.Spelling"),
            "Vale.Spelling",
        )

    def test_sanitizes_unsafe_rule(self):
        result = vale_reporter.format_rule_link("Elastic.Bad](https://evil.example)")
        self.assertNotIn("https://evil.example", result)
        self.assertNotIn("]", result)


if __name__ == "__main__":
    unittest.main()
