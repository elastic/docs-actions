#!/usr/bin/env python3
"""Test the activation gate of the docs review and issue scope workflows.

Both workflows use `roles: all`, so the `if:` expression on the activation job of the compiled lock
file is the only check that decides who can start a run. This script reads that expression from
each lock file and evaluates it against a matrix of events. It supports the small part of the
GitHub Actions expression language that the gates use: string literals, property lookups, `==`,
`!=`, `!`, `&&`, `||`, parentheses, `contains`, `startsWith`, and `fromJSON`.

Usage: python3 scripts/test_activation_gates.py
"""

import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"
REPO = "elastic/docs-content"
TRUSTED = ["OWNER", "MEMBER", "COLLABORATOR"]
UNTRUSTED = ["NONE", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN"]

TOKEN = re.compile(
    r"\s*(?:(?P<str>'(?:[^']|'')*')|(?P<op>==|!=|&&|\|\||[!(),])|(?P<id>[A-Za-z_][\w.\-]*))"
)


def tokenize(text):
    tokens, pos = [], 0
    while pos < len(text):
        if not text[pos:].strip():
            break
        match = TOKEN.match(text, pos)
        if not match:
            raise ValueError(f"cannot tokenize at: {text[pos:pos + 30]!r}")
        kind = match.lastgroup
        value = match.group(kind)
        if kind == "str":
            value = value[1:-1].replace("''", "'")
        tokens.append((kind, value))
        pos = match.end()
    return tokens


class Evaluator:
    def __init__(self, tokens, context):
        self.tokens, self.pos, self.context = tokens, 0, context

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else (None, None)

    def take(self, value=None):
        kind, text = self.peek()
        if value is not None and text != value:
            raise ValueError(f"expected {value!r}, got {text!r}")
        self.pos += 1
        return kind, text

    def parse(self):
        result = self.or_expr()
        if self.pos != len(self.tokens):
            raise ValueError(f"unexpected token {self.peek()!r}")
        return result

    def or_expr(self):
        left = self.and_expr()
        while self.peek() == ("op", "||"):
            self.take()
            right = self.and_expr()
            left = left if truthy(left) else right
        return left

    def and_expr(self):
        left = self.eq_expr()
        while self.peek() == ("op", "&&"):
            self.take()
            right = self.eq_expr()
            left = right if truthy(left) else left
        return left

    def eq_expr(self):
        left = self.unary()
        while self.peek() in (("op", "=="), ("op", "!=")):
            _, op = self.take()
            right = self.unary()
            same = loose_equal(left, right)
            left = same if op == "==" else not same
        return left

    def unary(self):
        if self.peek() == ("op", "!"):
            self.take()
            return not truthy(self.unary())
        return self.primary()

    def primary(self):
        kind, text = self.take()
        if kind == "str":
            return text
        if text == "(":
            value = self.or_expr()
            self.take(")")
            return value
        if kind == "id":
            if self.peek() == ("op", "("):
                self.take("(")
                args = []
                if self.peek() != ("op", ")"):
                    args.append(self.or_expr())
                    while self.peek() == ("op", ","):
                        self.take()
                        args.append(self.or_expr())
                self.take(")")
                return call(text, args)
            if text in ("true", "false", "null"):
                return {"true": True, "false": False, "null": None}[text]
            return lookup(self.context, text)
        raise ValueError(f"unexpected token {text!r}")


def lookup(context, path):
    value = context
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def truthy(value):
    return bool(value) if value is not None else False


def loose_equal(left, right):
    if isinstance(left, str) and isinstance(right, str):
        return left.lower() == right.lower()
    return left == right


def call(name, args):
    name = name.lower()
    if name == "fromjson":
        return json.loads(args[0])
    if name == "startswith":
        return isinstance(args[0], str) and args[0].lower().startswith(str(args[1]).lower())
    if name == "contains":
        haystack, needle = args
        if isinstance(haystack, list):
            return any(loose_equal(item, needle) for item in haystack)
        return isinstance(haystack, str) and str(needle).lower() in haystack.lower()
    raise ValueError(f"unsupported function {name}")


def gate_expression(lock):
    data = yaml.safe_load((WORKFLOWS / lock).read_text())
    expression = data["jobs"]["activation"].get("if")
    if not expression:
        raise SystemExit(f"FAIL: {lock} has no `if:` on the activation job. With roles: all, nothing gates a run.")
    return " ".join(str(expression).split())


def event(name, action=None, **fields):
    payload = {"action": action} if action else {}
    payload.update(fields)
    return {"github": {"event_name": name, "repository": REPO, "event": payload}}


def comment(action, association=None, user_type="User"):
    return event(
        "issue_comment",
        action,
        comment={"author_association": association, "user": {"type": user_type}, "body": "text"},
    )


def pull_request(head_repo):
    return event("pull_request", "opened", pull_request={"head": {"repo": {"full_name": head_repo}}})


COMMON = (
    [(f"comment from {a}", comment("created", a), True) for a in TRUSTED]
    + [(f"comment from {a}", comment("created", a), False) for a in UNTRUSTED]
    + [
        ("menu edit of a bot comment", comment("edited", "NONE", "Bot"), True),
        ("edit of a user comment by an outside user", comment("edited", "NONE", "User"), False),
        # The association belongs to the comment author, so a member who edits their own comment
        # is still a trusted author.
        ("edit of a member's own comment", comment("edited", "MEMBER", "User"), True),
        ("workflow_dispatch", event("workflow_dispatch"), True),
        ("schedule", event("schedule"), False),
        ("push", event("push"), False),
    ]
)

MATRIX = {
    "gh-aw-docs-review.lock.yml": COMMON
    + [
        ("pull request from the same repository", pull_request(REPO), True),
        ("pull request from a fork", pull_request("someone/docs-content"), False),
        ("new issue", event("issues", "opened"), False),
    ],
    "gh-aw-issue-scope.lock.yml": COMMON
    + [
        ("new issue", event("issues", "opened"), True),
        ("edited issue", event("issues", "edited"), False),
        ("pull request from the same repository", pull_request(REPO), False),
    ],
}


def main():
    failures = 0
    for lock, cases in MATRIX.items():
        expression = gate_expression(lock)
        # The repository comparison needs github.repository, so add it next to github.event.
        for name, context, expected in cases:
            context["github"]["repository"] = REPO
            result = truthy(Evaluator(tokenize(expression), context).parse())
            status = "ok  " if result == expected else "FAIL"
            if result != expected:
                failures += 1
            print(f"{status} {lock}: {name}: {'runs' if result else 'skipped'}")
    if failures:
        print(f"\n{failures} case(s) failed.")
        sys.exit(1)
    print("\nAll activation gate cases passed.")


if __name__ == "__main__":
    main()
