// The IPC channels between the main process and the preload. Kept apart from the backend, so the
// sandboxed preload bundles no Node code.

export const LIST_PROFILES = "board-app:list-profiles";
export const SET_PROFILE_TICK = "board-app:set-profile-tick";

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
