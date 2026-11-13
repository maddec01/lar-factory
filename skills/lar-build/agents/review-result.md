# Review input and result

Input: build work ID, repository and supplied diff command. Round 1 covers the
whole branch. Round 2 covers every round-1 fix and your fixed findings only.
Read the brief with `lar-work body ID --body brief`. Follow project rules and
leave the worktree as found; the builder assigns fixes.

Output: the builder saves your result in `record-review-round` and dispositions.
Report within the factory report limit:

```
verdict: approve | changes
findings:
- [blocker|should|nit] path:line or screen: problem. Fix: <suggestion>. Confidence: high|medium|low
not checked:
- <anything you could not verify, and why>
```

The UI role also returns its app/process report and screenshot paths as its
own instructions require. Report evidence and limitations, not new scope.
