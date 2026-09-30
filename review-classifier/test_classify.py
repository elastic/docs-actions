#!/usr/bin/env python3

# Licensed to Elasticsearch B.V under one or more agreements.
# Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
# See the LICENSE file in the project root for more information

"""Tests for classify.py."""

import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import classify  # noqa: E402


def page(body, frontmatter=None, lines=0):
    """Build a page with optional frontmatter and filler lines."""
    parts = []
    if frontmatter is not None:
        parts.append("---\n" + frontmatter.strip("\n") + "\n---\n")
    parts.append(body.strip("\n") + "\n")
    parts.extend(f"Filler line {i}.\n" for i in range(lines))
    return "".join(parts)


def run(files, base=None, head=None, config=None, labels=(), events=()):
    base = base or {}
    head = head or {}
    cfg = dict(classify.DEFAULT_CONFIG)
    cfg.update(config or {})
    return classify.classify(
        files,
        read_base=base.get,
        read_head=head.get,
        list_head_files=lambda: sorted(head),
        config=cfg,
        labels=labels,
        label_events=events,
    )


def ids(decision):
    return [r["id"] for r in decision["reasons"]]


def modified(path):
    return {"filename": path, "status": "modified"}


class SkipAndLightTests(unittest.TestCase):
    def test_only_automation_files_are_skipped(self):
        decision = run([modified(".github/workflows/ci.yml"), modified("explore/models.csv")])
        self.assertEqual(decision["tier"], "skip")
        self.assertEqual(decision["reasons"], [])

    def test_extra_skip_paths(self):
        decision = run([modified("README.md")], config={"skip_paths": [".github/**", "README.md"]})
        self.assertEqual(decision["tier"], "skip")

    def test_small_edit_is_light(self):
        base = {"a/p.md": page("# Title\n\nSome text.", lines=20)}
        head = {"a/p.md": page("# Title\n\nSome better text.", lines=20)}
        decision = run([modified("a/p.md")], base, head)
        self.assertEqual(decision["tier"], "light")

    def test_generated_reference_files_are_not_skipped(self):
        base = {"reference/gen.md": page("# Ref\n\nText.", lines=20)}
        head = {"reference/gen.md": page("# Ref\n\nText two.", lines=20)}
        decision = run([modified("reference/gen.md")], base, head)
        self.assertEqual(decision["tier"], "light")


class StructuralTests(unittest.TestCase):
    def test_new_page(self):
        decision = run([{"filename": "a/new.md", "status": "added"}], head={"a/new.md": "# New\n"})
        self.assertEqual(ids(decision), ["new-page"])
        self.assertEqual(decision["tier"], "full")

    def test_new_snippet_is_not_a_page_by_default(self):
        files = [{"filename": "a/_snippets/s.md", "status": "added"}]
        decision = run(files, head={"a/_snippets/s.md": "Text.\n"})
        self.assertEqual(decision["tier"], "light")
        decision = run(files, head={"a/_snippets/s.md": "Text.\n"}, config={"pages_exclude_snippets": False})
        self.assertEqual(ids(decision), ["new-page"])

    def test_page_deleted(self):
        decision = run([{"filename": "a/old.md", "status": "removed"}], base={"a/old.md": "# Old\n"})
        self.assertEqual(ids(decision), ["page-deleted"])

    def test_pure_rename_is_light(self):
        text = page("# Title\n\nText.", lines=10)
        files = [{"filename": "b/p.md", "status": "renamed", "previous_filename": "a/p.md"}]
        decision = run(files, base={"a/p.md": text}, head={"b/p.md": text})
        self.assertEqual(decision["tier"], "light")

    def test_rename_reads_base_from_previous_filename(self):
        files = [{"filename": "b/p.md", "status": "renamed", "previous_filename": "a/p.md"}]
        base = {"a/p.md": page("# Title\n\nText.", lines=10)}
        head = {"b/p.md": page("# Title\n\n## New section\n\nText.", lines=10)}
        decision = run(files, base, head)
        self.assertEqual(ids(decision), ["substantial-change"])
        self.assertEqual(decision["reasons"][0]["detail"], "headings")

    def test_redirect_added(self):
        base = {"redirects.yml": "redirects:\n  'a.md': 'b.md'\n"}
        head = {"redirects.yml": "redirects:\n  'a.md': 'b.md'\n  'c.md':\n    to: 'd.md'\n    anchors:\n      'x': 'y'\n"}
        decision = run([modified("redirects.yml")], base, head)
        self.assertEqual(ids(decision), ["redirect-added"])
        self.assertEqual(decision["reasons"][0]["value"], 1)

    def test_redirect_target_change_does_not_fire(self):
        base = {"redirects.yml": "redirects:\n  'a.md': 'b.md'\n"}
        head = {"redirects.yml": "redirects:\n  'a.md':\n    to: 'c.md'\n    anchors:\n      'old': 'new'\n"}
        decision = run([modified("redirects.yml")], base, head)
        self.assertEqual(decision["tier"], "light")

    def test_netlify_redirects_file(self):
        base = {"_redirects": "/a /b 301\n"}
        head = {"_redirects": "/a /b 301\n/c /d 301\n"}
        decision = run([modified("_redirects")], base, head)
        self.assertEqual(ids(decision), ["redirect-added"])

    def test_large_scope_threshold(self):
        files = [{"filename": f"img/{i}.txt", "status": "modified"} for i in range(5)]
        self.assertEqual(run(files)["tier"], "light")
        files.append({"filename": "img/5.txt", "status": "modified"})
        decision = run(files)
        self.assertEqual(ids(decision), ["large-scope"])
        self.assertEqual(decision["reasons"][0]["value"], 6)

    def test_skip_listed_files_do_not_count_for_scope(self):
        files = [modified(f".github/w{i}.yml") for i in range(5)] + [modified("a.txt")]
        self.assertEqual(run(files)["tier"], "light")


class ContentTests(unittest.TestCase):
    def test_images_threshold(self):
        files = [modified("images/a.png"), {"filename": "images/b.SVG", "status": "added"}]
        self.assertEqual(run(files)["tier"], "light")
        files.append({"filename": "images/c.webp", "status": "removed"})
        decision = run(files)
        self.assertEqual(ids(decision), ["images-changed"])

    def snippet_tree(self, includer_b):
        return {
            "docset.yml": "toc: []\n",
            "a/_snippets/s.md": "New snippet text.\n",
            "a/one.md": ":::{include} _snippets/s.md\n:::\n",
            "a/two.md": ":::{include} /a/_snippets/s.md\n:::\n",
            "b/three.md": includer_b,
        }

    def test_snippet_used_in_one_folder_does_not_fire(self):
        head = self.snippet_tree("No include here.\n")
        decision = run([modified("a/_snippets/s.md")], {"a/_snippets/s.md": "Snippet text.\n"}, head)
        self.assertEqual(decision["tier"], "light")

    def test_snippet_used_across_top_level_folders_fires(self):
        head = self.snippet_tree("   ::::{include} ../a/_snippets/s.md\n   ::::\n")
        decision = run([modified("a/_snippets/s.md")], {"a/_snippets/s.md": "Snippet text.\n"}, head)
        self.assertEqual(ids(decision), ["shared-snippet"])
        self.assertEqual(decision["reasons"][0]["value"], 2)

    def test_nested_snippet_include(self):
        head = self.snippet_tree("No include here.\n")
        head["a/_snippets/s.md"] = "New.\n"
        head["b/_snippets/wrapper.md"] = ":::{include} /a/_snippets/s.md\n:::\n"
        head["b/four.md"] = ":::{include} _snippets/wrapper.md\n:::\n"
        decision = run([modified("a/_snippets/s.md")], {"a/_snippets/s.md": "Old.\n"}, head)
        self.assertEqual(ids(decision), ["shared-snippet"])

    def test_new_snippet_used_across_folders_fires(self):
        head = {
            "a/_snippets/s.md": "New snippet.\n",
            "a/one.md": page("# One\n\n:::{include} _snippets/s.md\n:::", lines=300),
            "b/two.md": page("# Two\n\n:::{include} /a/_snippets/s.md\n:::", lines=300),
        }
        base = {"a/one.md": page("# One", lines=300), "b/two.md": page("# Two", lines=300)}
        files = [{"filename": "a/_snippets/s.md", "status": "added"}, modified("a/one.md"), modified("b/two.md")]
        decision = run(files, base, head)
        self.assertEqual(ids(decision), ["shared-snippet"])

    def test_snippet_directory_scope(self):
        head = {
            "a/_snippets/s.md": "New.\n",
            "a/x/one.md": ":::{include} /a/_snippets/s.md\n:::\n",
            "a/y/two.md": ":::{include} /a/_snippets/s.md\n:::\n",
        }
        files = [modified("a/_snippets/s.md")]
        self.assertEqual(run(files, {"a/_snippets/s.md": "Old.\n"}, head)["tier"], "light")
        decision = run(files, {"a/_snippets/s.md": "Old.\n"}, head, config={"snippet_scope": "directory"})
        self.assertEqual(ids(decision), ["shared-snippet"])

    def test_heading_added_fires(self):
        base = {"p.md": page("# Title\n\nText.", lines=50)}
        head = {"p.md": page("# Title\n\n## Extra\n\nText.", lines=50)}
        decision = run([modified("p.md")], base, head)
        self.assertEqual(decision["reasons"][0]["detail"], "headings")

    def test_heading_rename_fires(self):
        base = {"p.md": page("# Title\n\n## Old name\n\nText.", lines=50)}
        head = {"p.md": page("# Title\n\n## New name\n\nText.", lines=50)}
        decision = run([modified("p.md")], base, head)
        self.assertEqual(ids(decision), ["substantial-change"])

    def test_hash_lines_in_code_and_frontmatter_are_not_headings(self):
        base = {"p.md": page("# Title\n\n```bash\necho hi\n```", frontmatter="title: x", lines=50)}
        head = {"p.md": page("# Title\n\n```bash\n# comment\necho hi\n```", frontmatter="# note\ntitle: x", lines=50)}
        decision = run([modified("p.md")], base, head)
        self.assertEqual(decision["tier"], "light")

    def test_headings_inside_directives_count(self):
        base = {"p.md": page("# Title\n\n```{note}\nText.\n```", lines=50)}
        head = {"p.md": page("# Title\n\n```{note}\n## Inside\nText.\n```", lines=50)}
        self.assertEqual(ids(run([modified("p.md")], base, head)), ["substantial-change"])

    def test_small_page_threshold(self):
        body = "# Title\n\n" + "".join(f"Line {i}.\n" for i in range(20))
        edited = body.replace("Line 1.\n", "Changed 1.\n").replace("Line 2.\n", "Changed 2.\n")
        # 4 of 22 lines changed = 18%: below 20%.
        self.assertEqual(run([modified("p.md")], {"p.md": body}, {"p.md": edited})["tier"], "light")
        edited = edited.replace("Line 3.\n", "Changed 3.\n")
        decision = run([modified("p.md")], {"p.md": body}, {"p.md": edited})
        self.assertEqual(decision["reasons"][0]["detail"], "lines")
        self.assertEqual(decision["reasons"][0]["value"], 27)

    def test_large_page_threshold(self):
        body = "# Title\n\n" + "".join(f"Line {i}.\n" for i in range(600))
        edited = body
        for i in range(16):
            edited = edited.replace(f"Line {i}.\n", f"Changed {i}.\n")
        # 32 of 602 lines = 5.3%.
        decision = run([modified("p.md")], {"p.md": body}, {"p.md": edited})
        self.assertEqual(ids(decision), ["substantial-change"])

    def test_rewrap_and_whitespace_do_not_count(self):
        body = "# Title\n\nThis is a long sentence that\nwraps over two lines.\n\n  Indented.\n"
        edited = "# Title\n\nThis is a long sentence\nthat wraps over two lines.\n\nIndented.   \n"
        self.assertEqual(classify.line_changes(body, edited), (0, 0))

    def test_applies_to_frontmatter_modified(self):
        fm = "applies_to:\n  deployment:\n    ece: ga\n    ess: ga\n"
        base = {"p.md": page("# T", frontmatter=fm, lines=100)}
        head = {"p.md": page("# T", frontmatter=fm.replace("ece: ga", "ece: preview"), lines=100)}
        self.assertEqual(ids(run([modified("p.md")], base, head)), ["applies-to-modified"])

    def test_applies_to_added_or_reordered_does_not_fire(self):
        fm = "applies_to:\n  deployment:\n    ece: ga\n    ess: ga\n"
        reordered = "applies_to:\n    deployment:\n        ess: ga\n        ece: ga\n    serverless: ga\n"
        base = {"p.md": page("# T\n\nText.", frontmatter=fm, lines=100)}
        head = {"p.md": page("# T\n\nText {applies_to}`stack: ga 9.4+`.", frontmatter=reordered, lines=100)}
        self.assertEqual(run([modified("p.md")], base, head)["tier"], "light")

    def test_applies_to_inline_directive_and_block_forms(self):
        cases = [
            ("Text {applies_to}`stack: ga 9.4+`.", "Text {applies_to}`stack: ga 9.5+`."),
            (":::{note}\n:applies_to: { ece: ga, ess: ga }\nText.\n:::", ":::{note}\n:applies_to: { ece: ga }\nText.\n:::"),
            ("```{applies_to}\ndeployment:\n  ess: ga\n```", "```{applies_to}\ndeployment:\n  ess: beta\n```"),
            (":::{note}\n:applies_to: serverless:\nText.\n:::", ":::{note}\nText.\n:::"),
        ]
        for before, after in cases:
            with self.subTest(before=before):
                base = {"p.md": page("# T\n\n" + before, lines=100)}
                head = {"p.md": page("# T\n\n" + after, lines=100)}
                self.assertEqual(ids(run([modified("p.md")], base, head)), ["applies-to-modified"])

    def test_external_links(self):
        cases = [
            ("See [x](https://example.com/a).", True),
            ("See [x](https://www.elastic.co/docs/a).", False),
            ("See [x](https://elastic.co/a).", False),
            ("See [x](https://github.com/elastic/kibana/pull/1).", False),
            ("See [x](https://github.com/elasticsearch-fork/x).", True),
            ("Run `curl https://example.com`.", False),
            ("```sh\ncurl https://example.com\n```", False),
        ]
        for text, fires in cases:
            with self.subTest(text=text):
                base = {"p.md": page("# T\n\nIntro.", lines=100)}
                head = {"p.md": page("# T\n\nIntro.\n\n" + text, lines=100)}
                decision = run([modified("p.md")], base, head)
                self.assertEqual("external-link-added" in ids(decision), fires)

    def test_existing_external_link_moved_does_not_fire(self):
        base = {"p.md": page("# T\n\nA [x](https://example.com).\n\nB.", lines=100)}
        head = {"p.md": page("# T\n\nB.\n\nA [x](https://example.com).", lines=100)}
        self.assertEqual(run([modified("p.md")], base, head)["tier"], "light")

    def test_new_page_with_external_link_reports_both(self):
        files = [{"filename": "p.md", "status": "added"}]
        decision = run(files, head={"p.md": "# T\n\n[x](https://example.com)\n"})
        self.assertEqual(ids(decision), ["new-page", "external-link-added"])


class ConfigTriggerTests(unittest.TestCase):
    def test_disabled_trigger_does_not_fire(self):
        files = [{"filename": "a/new.md", "status": "added"}]
        config = classify.load_config({"triggers": {"new-page": False}})
        decision = run(files, head={"a/new.md": "# New\n"}, config=config)
        self.assertEqual(decision["tier"], "light")

    def test_headings_option(self):
        base = {"p.md": page("# Title\n\nText.", lines=50)}
        head = {"p.md": page("# Title\n\n## Extra\n\nText.", lines=50)}
        config = classify.load_config({"triggers": {"substantial-change": {"headings": False}}})
        self.assertEqual(run([modified("p.md")], base, head, config=config)["tier"], "light")

    def test_custom_rule(self):
        config = classify.load_config({"custom": [
            {"id": "security", "label": "Security page", "paths": ["deploy-manage/security/**"], "statuses": ["modified"]},
        ]})
        text = page("# T\n\nText.", lines=50)
        files = [modified("deploy-manage/security/a.md"), {"filename": "deploy-manage/security/b.md", "status": "removed"}]
        decision = run(files, {"deploy-manage/security/a.md": text}, {"deploy-manage/security/a.md": text + "More.\n"},
                          config=config)
        self.assertEqual(decision["reasons"][-1], {"id": "custom:security", "file": "deploy-manage/security/a.md",
                                                   "value": None, "detail": None})
        self.assertEqual(ids(decision), ["page-deleted", "custom:security"])


class OverrideTests(unittest.TestCase):
    NEW_PAGE = ([{"filename": "p.md", "status": "added"}], {}, {"p.md": "# T\n"})

    def events(self, *items):
        return [{"event": e, "label": l, "actor": a} for e, l, a in items]

    def test_human_light_label_overrides_full(self):
        files, base, head = self.NEW_PAGE
        events = self.events(("labeled", "review: light", "octocat"))
        decision = run(files, base, head, labels=["review: light"], events=events)
        self.assertEqual((decision["tier"], decision["computed_tier"]), ("light", "full"))
        self.assertEqual(decision["override"], "review: light")
        self.assertEqual(ids(decision), ["new-page"])

    def test_bot_label_is_not_an_override(self):
        files, base, head = self.NEW_PAGE
        events = self.events(("labeled", "review: light", classify.BOT_LOGIN))
        decision = run(files, base, head, labels=["review: light"], events=events)
        self.assertEqual(decision["tier"], "full")
        self.assertIsNone(decision["override"])
        self.assertEqual(decision["bot_labels"], ["review: light"])

    def test_label_reapplied_by_human_after_bot(self):
        files, base, head = self.NEW_PAGE
        events = self.events(
            ("labeled", "review: light", classify.BOT_LOGIN),
            ("unlabeled", "review: light", "octocat"),
            ("labeled", "review: light", "octocat"),
        )
        decision = run(files, base, head, labels=["review: light"], events=events)
        self.assertEqual(decision["tier"], "light")

    def test_both_human_labels_full_wins(self):
        decision = run([modified("a.txt")], labels=["review: light", "review: full"])
        self.assertEqual((decision["tier"], decision["override"]), ("full", "review: full"))

    def test_same_tier_label_is_not_reported_as_override(self):
        files, base, head = self.NEW_PAGE
        decision = run(files, base, head, labels=["review: full"])
        self.assertEqual(decision["tier"], "full")
        self.assertIsNone(decision["override"])


class HelperTests(unittest.TestCase):
    def test_glob(self):
        match = classify.PathMatcher(["**/_snippets/**", ".github/**", "*.csv"])
        self.assertTrue(match("_snippets/a.md"))
        self.assertTrue(match("x/y/_snippets/a.md"))
        self.assertTrue(match(".github/workflows/a.yml"))
        self.assertTrue(match("deep/dir/models.csv"))
        self.assertFalse(match("x/snippets.md"))
        self.assertFalse(match("docs/.github.md"))

    def test_status_mapping(self):
        self.assertEqual(classify.normalize_status("changed"), "modified")
        self.assertEqual(classify.normalize_status("copied"), "added")
        self.assertEqual(classify.normalize_status("R087"), "renamed")
        self.assertEqual(classify.normalize_status("removed"), "removed")

    def test_size_thresholds(self):
        thresholds = classify.parse_size_thresholds("199:20,500:10,5")
        self.assertEqual(thresholds, [(199, 20.0), (500, 10.0), (None, 5.0)])
        self.assertEqual(classify.threshold_for(199, thresholds), 20)
        self.assertEqual(classify.threshold_for(200, thresholds), 10)
        self.assertEqual(classify.threshold_for(500, thresholds), 10)
        self.assertEqual(classify.threshold_for(501, thresholds), 5)
        with self.assertRaises(ValueError):
            classify.parse_size_thresholds("199:20")

    def test_load_config_defaults(self):
        config = classify.load_config(None)
        self.assertEqual(config, classify.load_config({}))
        self.assertTrue(all(config["enabled"].values()))
        self.assertEqual(config["light_label"], "review: light")

    def test_load_config_values(self):
        config = classify.load_config({
            "labels": {"light": "tier: light"},
            "checklists": {"full": "https://example.test/full"},
            "skip-paths": ["README.md", "AGENTS.md"],
            "vale": {"enabled": False, "max-findings": 3, "paths": ["docs/**"]},
            "triggers": {
                "new-page": False,
                "large-scope": {"max-files": 8},
                "shared-snippet": {"scope": "directory"},
                "substantial-change": {"headings": False, "thresholds": ["99:30", 10]},
                "external-link-added": {"enabled": False},
            },
            "custom": [{"id": "security", "label": "Security page", "paths": "deploy-manage/security/**",
                        "statuses": ["added", "modified"]}],
        })
        self.assertEqual(config["light_label"], "tier: light")
        self.assertEqual(config["full_url"], "https://example.test/full")
        self.assertEqual(config["skip_paths"], [".github/**", "**/*.csv", "README.md", "AGENTS.md"])
        self.assertEqual((config["vale_enabled"], config["vale_max_findings"], config["vale_paths"]),
                         (False, 3, ["docs/**"]))
        self.assertFalse(config["enabled"]["new-page"])
        self.assertFalse(config["enabled"]["external-link-added"])
        self.assertTrue(config["enabled"]["large-scope"])
        self.assertEqual(config["max_files"], 8)
        self.assertEqual(config["snippet_scope"], "directory")
        self.assertFalse(config["headings"])
        self.assertEqual(config["size_thresholds"], [(99, 30.0), (None, 10.0)])
        self.assertEqual(config["custom"][0]["paths"], ["deploy-manage/security/**"])
        # The defaults are not changed by a load.
        self.assertTrue(classify.DEFAULT_CONFIG["enabled"]["new-page"])

    def test_example_config_matches_defaults(self):
        import json
        import shutil
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.yml")
        if shutil.which("yq"):
            data = json.loads(subprocess.run(["yq", "-o=json", ".", path], check=True, capture_output=True).stdout)
        else:
            try:
                import yaml
            except ImportError:
                self.skipTest("needs yq or PyYAML")
            with open(path) as f:
                data = yaml.safe_load(f)
        self.assertEqual(classify.load_config(data), classify.load_config(None))

    def test_load_config_rejects_mistakes(self):
        bad = [
            [],
            {"trigger": {}},
            {"triggers": {"new-pages": True}},
            {"triggers": {"large-scope": {"max_files": 3}}},
            {"triggers": {"large-scope": {"max-files": "3"}}},
            {"triggers": {"shared-snippet": {"scope": "repo"}}},
            {"triggers": {"substantial-change": {"thresholds": ["199:20"]}}},
            {"labels": {"light": "same", "full": "same"}},
            {"checklists": {"light": "http://insecure"}},
            {"vale": {"max-findings": 99}},
            {"custom": [{"id": "Bad ID", "label": "x", "paths": ["a/**"]}]},
            {"custom": [{"id": "a", "label": "x", "paths": ["a/**"]}, {"id": "a", "label": "y", "paths": ["b/**"]}]},
            {"custom": [{"id": "a", "label": "x", "paths": ["a/**"], "statuses": ["edited"]}]},
            {"custom": [{"id": "a", "paths": ["a/**"]}]},
        ]
        for data in bad:
            with self.subTest(data=data):
                with self.assertRaises(classify.ConfigError):
                    classify.load_config(data)

    def test_check_config_cli(self):
        import contextlib
        import io
        import json
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "config.json")
            with open(path, "w") as f:
                f.write('{"vale": {"enabled": false, "paths": ["docs/**"]}}')
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(classify.main(["check-config", path]), 0)
            self.assertEqual(json.loads(out.getvalue()), {"vale_enabled": False, "vale_paths": ["docs/**"]})
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(classify.main(["check-config", os.path.join(tmp, "missing.json")]), 0)
            with open(path, "w") as f:
                f.write('{"vale": {"on": true}}')
            self.assertEqual(classify.main(["check-config", path]), 1)

    def test_flow_and_block_pairs(self):
        self.assertEqual(
            classify.flow_pairs("{ deployment: { ece: ga, ess: }, serverless: 'ga' }"),
            [("deployment.ece", "ga"), ("deployment.ess", ""), ("serverless", "ga")],
        )
        self.assertEqual(
            classify.block_pairs(["stack: ga 9.0", "deployment:", "  self:", "  ess: ga  # comment"]),
            [("stack", "ga 9.0"), ("deployment.self", ""), ("deployment.ess", "ga")],
        )


class GitReaderTests(unittest.TestCase):
    def git(self, root, *args):
        subprocess.run(["git", "-C", root, *args], check=True, capture_output=True)

    def test_main_reads_base_and_head_from_git(self):
        with tempfile.TemporaryDirectory() as root:
            self.git(root, "init", "-q")
            self.git(root, "config", "user.email", "t@example.com")
            self.git(root, "config", "user.name", "t")
            with open(os.path.join(root, "p.md"), "w") as f:
                f.write("# Title\n\nText.\n")
            self.git(root, "add", ".")
            self.git(root, "commit", "-qm", "base")
            with open(os.path.join(root, "p.md"), "w") as f:
                f.write("# Title\n\n## New\n\nText.\n")
            self.git(root, "commit", "-qam", "head")

            reader = classify.GitReader(root)
            try:
                self.assertIn("## New", reader.read("HEAD", "p.md"))
                self.assertNotIn("## New", reader.read("HEAD~1", "p.md"))
                self.assertIsNone(reader.read("HEAD", "missing.md"))
                self.assertEqual(reader.list_files("HEAD"), ["p.md"])
            finally:
                reader.close()

            files = os.path.join(root, "files.json")
            with open(files, "w") as f:
                f.write('[{"filename": "p.md", "status": "modified"}]')
            out = os.path.join(root, "out", "decision.json")
            code = classify.main([
                "--repo-root", root, "--base-rev", "HEAD~1", "--files", files,
                "--pr-number", "7", "--head-sha", "a" * 40, "--dry-run", "--output", out,
            ])
            self.assertEqual(code, 0)
            with open(out) as f:
                import json
                decision = json.load(f)
            self.assertEqual(decision["tier"], "full")
            self.assertTrue(decision["dry_run"])
            self.assertEqual(decision["pr_number"], 7)

            config = os.path.join(root, "config.json")
            with open(config, "w") as f:
                f.write('{"triggers": {"substantial-change": false}}')
            classify.main([
                "--repo-root", root, "--base-rev", "HEAD~1", "--files", files, "--config", config,
                "--pr-number", "7", "--head-sha", "a" * 40, "--output", out,
            ])
            with open(out) as f:
                self.assertEqual(json.load(f)["tier"], "light")
            with open(config, "w") as f:
                f.write('{"triggers": {"bogus": true}}')
            self.assertEqual(classify.main([
                "--repo-root", root, "--base-rev", "HEAD~1", "--files", files, "--config", config,
                "--pr-number", "7", "--head-sha", "a" * 40, "--output", out,
            ]), 1)

if __name__ == "__main__":
    unittest.main()
