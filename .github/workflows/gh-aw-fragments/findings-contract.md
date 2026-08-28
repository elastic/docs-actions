## Findings contract

These rules apply to every finding this sweep emits. Sweep output is consumed by humans and, increasingly, by AI fix-agents that may act on it without a human in the loop. A finding that is uncertain, or that looks authoritative but is wrong, is worse than no finding at all.

### Finding-type allowlist

Emit only the `category` values enumerated in this workflow's "Build the findings list" step. That enumeration is a closed allowlist:

- Never invent, rename, pluralize, or otherwise vary a category string. If a finding does not map cleanly to an allowlisted category, drop it.
- A finding is valid only if applying its `suggested_fix` would change the page's rendered output or its published metadata. Drop no-op findings whose fix a reader would never see — for example, adding a marker the docs toolchain already generates automatically.
- If you spot something real that has no allowlisted category, describe it in the issue body's **Notes** section as prose. Do not smuggle it in as a finding under an invented category.

### Per-finding confidence

Add a `confidence` field to every finding, set to exactly one of `high`, `medium`, or `low`. Judge confidence on how safe the finding is to act on *without* human verification — this is a separate axis from `severity`, which measures impact:

- `high` — the problem and the fix are objective and verifiable from the evidence in front of you: a missing required field, a tool-flagged issue with a single unambiguous correction, a directly quoted contradiction. A fix-agent could apply the `suggested_fix` verbatim without judgment.
- `medium` — the finding is well-supported, but the fix involves wording choices, or depends on a repository convention you could not fully verify this run. A human should confirm the fix before it lands.
- `low` — the finding is plausible but rests on partial evidence, subjective judgment, or an assumption about intent or convention you could not confirm. If you cannot justify at least `low`, drop the finding rather than filing it.

When a finding's evidence traces back to text you did not verify — for example, terminology copied from an issue or PR description rather than confirmed against the code or the published docs — cap its confidence at `low` and say so in the `evidence`.

Include `confidence` in the YAML schema for every finding, alongside `severity`. Keep the existing sort order (by `severity` first); do not reorder by confidence.

### Human-review gate

If the capped findings list contains **any** finding with `confidence: medium` or `confidence: low`:

1. Add the label `needs-human-review` to your `create_issue` call, in addition to the labels the workflow adds automatically. This marks the issue as not safe to auto-action and keeps it out of the `good-for-ai` delegation track.
2. Immediately below the `## Findings (<count>)` heading and before the YAML block, add this callout verbatim:

   > [!WARNING]
   > This issue contains medium- or low-confidence findings. Review them before acting — auto-applying sweep output without verification risks putting incorrect content into the docs. Findings marked `confidence: high` are safe to delegate to a fix-agent; `medium` and `low` need a human sign-off first.

If every finding is `confidence: high`, do not add the label or the callout: the issue is safe to delegate as-is.
