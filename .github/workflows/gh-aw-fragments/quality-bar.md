## Reference: quality bar for a well-formed issue

Score each of the five criteria below as **1** (clearly met) or **0** (clearly missing).
Sum the scores to get the rating:

| Total | Rating |
|-------|--------|
| 4–5   | 🟢 Green  |
| 2–3   | 🟠 Orange |
| 0–1   | 🔴 Red    |

### Criterion 1 — Specific, action-oriented title

**1:** the title names the exact problem or change without needing the body to decode it.
- ✅ "Python code snippet in Elasticsearch quick-start tutorial is invalid"
- ✅ "Add air-gapped configuration section to Elastic Agent install page"

**0:** the title is too vague to act on alone.
- ❌ "Update docs" / "Fix" / "Docs are wrong" / "Question"

### Criterion 2 — Clear request with a definition of done

**1:** the description states what the finished result looks like so an assignee knows when the ticket is closeable.
- ✅ "Update the installation methods table on the Elastic Agent page to include the new endpoint"
- ✅ "Add a note about the Kafka change so users can resolve it without filing a support ticket"

**0:** no definition of done — the reader cannot tell what to produce.
- ❌ "This doc must be improved." / "Please fix this."

### Criterion 3 — Context and motivation

**1:** the why or impact is stated, or is obvious from linked content (related ticket, forum post, user report).

**0:** the request is bare — no indication of why it matters, who is affected, or what triggered it.

### Criterion 4 — Template compliance for the issue type

Apply the rule for the router's type decision:

| Type | Score 1 — all present and substantive | Score 0 — any absent or placeholder |
|---|---|---|
| `bug` | What's broken + expected behavior + how to reproduce | Any of the three is missing |
| `enhancement` | Problem statement (why / who it helps) + proposed outcome or definition of done | Either is missing |
| `documentation` | Affected page or specific section + what should change or the desired reader outcome | Either is missing |
| `question` | The specific question + enough context to answer it | Either is missing |

Treat "N/A", "TBD", or "todo" as absent. For a type not in this table, score 1 when the key facts needed to start work are present.

### Criterion 5 — One issue, one testable problem

**1:** the issue is focused on a single task or a closely related bundle that can be assigned, completed, and closed in one go.

**0:** the issue bundles multiple unrelated bugs or requests, making it impossible to close cleanly or assign to one owner.

---

## Reference: ambiguity signals (apply only when they block action)

Do not deduct a criterion point for ambiguity alone. Flag an ambiguity signal only when it prevents any interpretation of the request:

- Frequency weasel words with no reproduction path: "sometimes", "occasionally", "randomly"
- Bare assertions with no description: "broken", "not working", "doesn't work"
- Vague goals as the entire objective: "improve", "fix", "update" with no specifics

Do not penalize hedging or broad scope when it preserves the author's uncertainty or signals an exploratory intent.

---

## Reference: universal label taxonomy

Apply these labels only when the label already exists in the target repository — never invent labels.

| Label | When to apply |
|---|---|
| `triaged` | Always — marks that triage has been run on this issue |
| `human-needed` | Issue is too incomplete to classify or refine without author input |
| `bug` | Something is broken, regressing, or behaving contrary to intent |
| `enhancement` | New capability, improvement, or feature request |
| `question` | Clarification needed before the issue can be actioned |
| `documentation` | A docs content change (not a tooling or infrastructure issue) |
