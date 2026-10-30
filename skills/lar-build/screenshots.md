# Screenshots

The UI reviewer keeps its screenshots outside the checkout, in
`${TMPDIR:-/tmp}/lar-<n>-ui/`, and the builder shows them to the user in the
build conversation by absolute path. Never commit them or put them in PR
descriptions or comments. PR evidence is a text summary of the visual checks
and their results, even where the `pr` skill suggests screenshots. Required
test fixtures and product assets follow the repo's rules; they aren't review
captures.
