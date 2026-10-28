# Prototype #525, round three

Title layouts on `/`, picked with `variant=A|D|E`. Desk cards are picked with
`desk=fixed|stretched`. Soft Queue starts and 28px controls are the same in every
layout.

## Why each control goes where it does

The title bar has three kinds of thing. The app's own controls are the "for T3
Code" tag, Update and Settings; you use them rarely and they apply everywhere.
Where you are is the scope and the refresh time. The board's state and actions
are the counters, List and Add item, which you use all day.

- A is the saved checkpoint, unchanged: app controls end the row, after Add item.
- D puts Settings and Update beside the app name. macOS keeps Settings and Check
  for Updates in the app menu, which carries the app's name, so this is where a
  Mac user looks for them. The divider then separates the app from the board,
  and the row ends on Add item, the board's primary action.
- E groups the refresh time and the five counters in one strip centred in the
  bar, as Xcode centres its activity view. The left says where you are, the
  middle how the board is doing, the right what you can do. Update and Settings
  stay at the right edge, after a divider.

## Desk cards

The cards were misaligned because each card grew only the rows it had. Some
titles took one line and others two, only some cards had a hint or a pipeline,
and Ready cards put their actions on two rows. Round two stretched every card to
the tallest, which left gaps. The fixed card instead gives every card the same
five rows:

1. status, repository and age
2. the title, always two lines tall (the full title is in the tooltip)
3. one next-step line: the PR's checks, what a Ready item waits on, or the hint
4. the step track
5. one action row: the main action on the left, Open thread as an icon on the right

A held Start build shows only Start after, as a dossier's map does.
