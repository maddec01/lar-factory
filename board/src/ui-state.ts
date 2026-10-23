// What the page remembers between renders, and where a fresh page starts.

import type { ModelChoice } from './model.ts';

export type View = 'board' | 'flow';

export interface UiState {
  view: View;
  /** Open or closed, by <details> id, for the ones the user toggled since the page loaded. */
  toggled: Record<string, boolean>;
  /** The item id of the build whose slice popover is open, if any. */
  slicesOpen?: string;
  /** The item id of the Queued card whose Start menu is open, if any. */
  startMenuOpen?: string;
  /** The model choice this browser last started with; none for "T3 default". */
  lastChoice?: ModelChoice;
}

export const DEFAULT_UI: UiState = { view: 'board', toggled: {} };
