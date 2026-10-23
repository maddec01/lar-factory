// The native dialog that asks before the app restarts to install an update, as T3 Code's
// dialogs.confirm. Closing the dialog picks Cancel.

import type * as Electron from "electron";

const RESTART = 0;
const CANCEL = 1;

export const options = (message: string): Electron.MessageBoxOptions => ({
  type: "question",
  message,
  buttons: ["Restart", "Cancel"],
  defaultId: RESTART,
  cancelId: CANCEL,
  noLink: true,
});

/** Whether the user chose Restart. */
export const confirmed = (result: Electron.MessageBoxReturnValue): boolean => result.response === RESTART;
