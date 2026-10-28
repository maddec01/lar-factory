# Prototype #525, round two

Three title layouts on the existing `/` board route, selected by `variant=A|B|C`.
Soft Queue starts and 28px action controls are fixed in every layout. These are
alternatives to compare. A remains preferred so far, without a final decision.

## Placement before implementation

- A keeps the first-round title layout exactly. The immutable reference is
  `prototype/525-small-ui-improvements` at
  `792d874830997aaa078a03eb8e3315aaadbb7743`, with `variant=A&queue=soft`.
- B puts app utilities in a left rail below the title bar. T3 Code identity,
  Update and Settings concern the app across every repository. Their stable
  position separates them from board scope and work. A 144px rail buys readable
  labels and persistent update discovery, at the cost of board width. Below
  768px it contracts to a 48px icon rail with accessible names and an update
  marker. The brand remains once in the title bar, followed by scope, refresh,
  counters, List and Add item. The rail never occupies the traffic-light area.
- C puts the same app utilities in a 40px bottom status bar outside the board's
  scroll area. Low-frequency housekeeping gets a consistent home and an update
  label remains visible while working. It costs 40px of board height. Board
  refresh still describes provider data beside scope; the bottom bar describes
  app software and T3 Code. Keeping these separate avoids implying that an app
  update refreshes board data. The brand and board actions remain in the title
  bar. Narrow screens keep identity, update availability and Settings visible.

## Desk diagnosis and common treatment

`desk.tsx` gives each card its own content-start grid. Its summary has a separate
grid whose height depends on a one- or two-line clamped title, an optional hint,
and a two-line pipeline only on Verify cards. Ready has no hint. Actions follow
that summary, and differing action sets can wrap. The outer flex row stretches
card shells but does not share their internal rows. This explains different
title, support, track and action positions.

Use CSS subgrid across the horizontal row for metadata, the full title, hint,
pipeline, stage track and actions with their feedback. Each row takes its tallest
content across the cards. Empty slots reserve the same row without inventing
information. Long titles remain readable without a line clamp. Actions align
at their top edge even when one card needs more buttons or wrapped actions.
Keep the fixture's different hints, missing threads, PRs and action sets, and
add a blocked Ready case. Every layout uses this same desk treatment.

## Native and keyboard constraints

The Mac app uses hiddenInset traffic lights at x=16 within a 52px title row.
`useWindowControlsInset` reserves 74px, plus the copied title bar's own padding.
B and C keep that row and its draggable region; controls remain no-drag.
The app minimum is 1024 by 700. Browser-only compact layouts below 768px may
hide the traffic-light stand-ins, matching A's existing prototype behavior.
DOM order follows visual order: title controls, B rail utilities, board; or
title controls, board, C status utilities. No positive tabindex is needed.
The first C tab stop is a focus-only App utilities link. It jumps to the footer,
so housekeeping does not require traversing every board card and action.
The prototype switcher sits above C's footer so it cannot cover app utilities.

Browser checks can inspect reserved space, drag CSS and keyboard order. They
cannot establish native window dragging, traffic-light hit targets, fullscreen
transitions, or real update downloads. Those remain native build verification.

## Round-two checks

Isolated Chrome via Playwright passed all three layouts at 320, 768, 1024 and
1440px, including the native minimum height of 700px at 1024px. Every desk slot
starts at the same y coordinate across nine cards. Titles are unclipped, Queue
starts share the Soft recipe, and action, icon and link samples measure 28px.
Update available and idle states, URL switching and reload, scope-menu keys,
Settings focus return, utility focus outlines and C's skip link passed. The
console had no errors or warnings and requests had no failures. Root typecheck
and knip passed. No tests or production implementation were added.
