// The IPC channels between the main process and the preload. Kept apart from the backend, so the
// sandboxed preload bundles no Node code.

export const LIST_PROFILES = "board-app:list-profiles";
export const SET_PROFILE_TICK = "board-app:set-profile-tick";
