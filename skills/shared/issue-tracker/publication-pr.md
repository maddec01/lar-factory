# Delivery PR relationships

Read the build's current record and use its own ticket when one exists. Its
concept's parent ticket is never the build's closing target. Work without a
ticket can still produce a PR.

Write the PR outcome, relevant decisions and checks from the local brief inside
the repository's template. Follow its title and link conventions. Link or close
only this build's own ticket through the provider's supported PR relationship.
This delivery relationship is separate from structural tracker sync. It adds no
queue, Status or progress text to a ticket. Preserve the team's Azure PR
completion settings and never change Azure State on the user's behalf.

Open the PR through its provider and record the reference immediately with
`lar-work set-pr <work ID> --revision N --pr <repository#n>`. Link the PR to the
thread. If creation loses its response, inspect PRs for the branch before trying
again. If a link is refused, report it and retain the recorded PR for local
completion; do not start a comment-publication workflow. The user merges every PR.
