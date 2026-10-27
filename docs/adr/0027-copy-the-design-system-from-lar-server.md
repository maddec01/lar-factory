---
status: accepted
---

# Copy the design system from lar-server

Settled in issue #477.

The board's design system is a copy of lar-server's `web/src/shared/design-system/`, on ninna-ui, recorded file by file in `packages/ui/UPSTREAM.md` against a lar-server commit. It replaces the T3 and coss Copies that ADR 0016 brought in, and base-ui leaves the board. Every lar app then looks the same, and a style change happens once in lar-server and reaches the board as a fresh copy. ADR 0011 still holds for the T3 code the board ports, such as the title bar's window controls and the update flow, but those now build on the copied components, and Base UI leaves its stack.

## Considered options

Keeping T3's components and setting only lar-server's token values was rejected. The dialogs, menus and popovers would still differ from lar-server's.

Turning the T3 Copies into Ports restyled by hand was rejected. The two apps would drift, and every lar-server change would need redoing by hand.

A shared package for both apps was rejected because it is another project to maintain.
