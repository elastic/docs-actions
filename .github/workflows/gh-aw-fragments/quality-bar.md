## Reference: quality bar for a well-formed issue

A well-formed issue has all of:

- **One clear goal.** Exactly one objective. If several are present, flag them and recommend splitting.
- **A stated outcome / definition of done** — what "fixed" or "shipped" looks like.
- **High-level and concise.** Describes the *what* and *why*, not the *how*. No invented implementation detail unless the fix is trivial and the detail is obviously known.
- **Specific, action-oriented title.**
- **Just enough context** — the why, the impact, and any acceptance criteria, without redundancy.
- Never add facts not supported by the issue or its comments. Preserve the author's intent.

## Reference: expected template sections

**Bug issues** (has `bug` label or title implies a regression/error) — must have all three:
- What's broken / the actual behavior
- Expected behavior
- How to trigger or reproduce it

**Feature / enhancement issues** (has `enhancement` label or requests new capability) — must have both:
- Problem statement: why this is needed and who it helps
- Proposed outcome or definition of done

**Question / documentation issues** — must have:
- What specific information is missing or unclear

## Reference: vague language signals

Flag these in the issue body as indicators of under-specified content:

- Frequency weasel words: "sometimes", "occasionally", "intermittently", "randomly"
- Hedged claims: "seems to", "appears to", "might", "maybe", "probably"
- Unspecified scope: "various", "some", "certain", "several", "etc.", "and so on"
- Bare assertions: "broken", "not working", "doesn't work" (with no description of what fails)
- Vague goals: "improve", "better", "fix", "update" as the entire objective, with no specifics

## Reference: universal label taxonomy

These labels are the universal triage classification set. Apply them only when the corresponding
label already exists in the target repository — never invent labels. Repositories may define
additional team or area labels; guidance for those is supplied through the workflow's
repo-specific instructions.

| Label | When to apply |
|---|---|
| `triaged` | Always — marks that triage has been run on this issue |
| `human-needed` | Issue is too incomplete to classify or refine without author input |
| `bug` | Something is broken, regressing, or behaving contrary to intent |
| `enhancement` | New capability, improvement, or feature request |
| `question` | Clarification needed before the issue can be actioned |
| `documentation` | A docs content change (not a tooling or infrastructure issue) |
