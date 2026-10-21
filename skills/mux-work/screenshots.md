# Screenshots

Keep review screenshots outside the checkout, in `${TMPDIR:-/tmp}/mux-<n>-ui/`,
and show them to Pedro in the build conversation with absolute file paths.
Never commit review screenshots or add them to PR descriptions or comments.
PR evidence is a text summary of the visual checks and their results, even when
the `pr` skill suggests screenshots. Required test fixtures and product assets
follow the repo's rules; they are separate from review captures.
