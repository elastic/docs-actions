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


if __name__ == "__main__":
    unittest.main()
