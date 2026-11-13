Ported from mattpocock/skills (skills/engineering/prototype); see UPSTREAM.md.

# UI prototype

Input: one appearance/interaction question and isolated worktree. Output:
variant commands/paths and branch for the owner to show and record with the pick.
Logic/state questions use [Logic prototype](prototype-logic.md).

Prefer variants inside an existing host page, including a new section/card/step.
Keep its data fetching, route params and auth; swap only the rendered subtree
using `?variant=`. Real surrounding UI and density expose design problems.
Use a new, clearly named throwaway route only when no plausible host exists,
following project routing conventions. Both forms use the same switcher.

State the question, variant count and route in a one-line plan near the code.
Build two or three variants differing only on the question but structurally
distinct in layout, hierarchy or primary action. Match the page's purpose, data
and component/style system. Give each a clear exported name. Redo similar
variants rather than changing only color/copy. Shared headers are fine; shared
layouts must not constrain the alternatives. Keep reads; stub mutations.

Use one shared switcher component where shared UI belongs. Default to variant A;
read/update the URL parameter through the framework router so choices survive
reload and are shareable. Its fixed bottom-center bar has wrapping previous/next
arrows and the current key plus optional name. Keyboard left/right also cycle,
except while an input, textarea or contenteditable element has focus. Make the
bar visually distinct from the evaluated design and hide it in production builds.

The owner shows every variant inside T3 per
[Show variants](prototype-question.md#show-the-variants-inside-t3), asks for a
variant or combination, and records the choice/reason and branch/preview in the
local shaping result. Preserve every variant and switcher on the prototype
branch. Never promote this throwaway code directly to production; later Build
implements the design with normal checks/review.
