// The IPC channels between the main process and the preload. Kept apart from the backend, so the
// sandboxed preload bundles no Node code.

// The skill install: the page reads its state at once and gets each change; the others are the page's operations.
export const INSTALL_GET_STATE = "board-app:install-get-state";
export const INSTALL_STATE = "board-app:install-state";
export const INSTALL_RETRY = "board-app:install-retry";
export const INSTALL_REPLACE = "board-app:install-replace";
export const INSTALL_SET_TICK = "board-app:install-set-tick";

// The window's full screen, as T3 Code's: the page reads it at once and gets each change on macOS.
export const GET_WINDOW_FULLSCREEN_STATE = "board-app:get-window-fullscreen-state";
export const WINDOW_FULLSCREEN_STATE = "board-app:window-fullscreen-state";

// The updater's calls, as T3 Code's apps/desktop/src/ipc/channels.ts. UPDATE_STATE pushes each
// new state to the page; the others are requests.
export const UPDATE_STATE = "board-app:update-state";
export const UPDATE_GET_STATE = "board-app:update-get-state";
export const UPDATE_CHECK = "board-app:update-check";
export const UPDATE_DOWNLOAD = "board-app:update-download";
export const UPDATE_INSTALL = "board-app:update-install";
export const UPDATE_SET_CHANNEL = "board-app:update-set-channel";

// Asks the user before the app restarts to install an update.
export const CONFIRM_RESTART = "board-app:confirm-restart";
