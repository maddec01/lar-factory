Ported from mattpocock/skills, `skills/engineering/pr/SKILL.md`. See [UPSTREAM.md](../../UPSTREAM.md) for the Ports record. Credit for the Summary visuals and placement guidance goes to Dex Horthy, Humanlayer, from `show-me`.

# Write a PR

Follow the repository's PR template and required links. Otherwise use Summary,
Test steps, Evidence and a one-line Risk. Lead with the concrete result and
only the product decisions a reviewer needs to understand it. A short before
and after example often explains a change better than a diagram; use a small
visual only when it helps.

Follow [PR delivery](shared/issue-tracker/publication-pr.md) for this build's
own ticket when present. Include its GitHub closing reference even when the
repository defines no link style. Azure uses the native PR work-item relationship
and the team's completion setting. A concept's parent ticket is separate from
the build's closing target. Keep the project's other PR rules.

```markdown
## Summary

<what changes for the user and why>

## Evidence

<checks run and their results; concise browser evidence when applicable>

Risk: <the concrete remaining risk or limitation, in one line>
```

Generate the Test steps section with `lar-work pr-body --test-steps` per
[Approver](agents/approver.md). Give reproducible steps and expected results;
they describe validation and do not add a human approval gate.

Evidence names the checks and outcomes, including failures that remain open.
Use the validation record for results already established on the final tree.
Keep reuse reasons, reviewer selection and skipped-role lists, Door and Blast
radius assessments in local validation/review records. Publish a material
unchecked area, open finding or unreviewed fix as a concise limitation or risk,
without reciting the review process. Omit empty sections and "none" lines.
For example, publish "Node 24: 17 tests passed", without appending who reused
the run or why its result still applies. Approver reassessment and CI updates
follow the same rule; those reasons belong only in local records.
Do not include local paths or factory IDs. Follow repository attribution rules.
