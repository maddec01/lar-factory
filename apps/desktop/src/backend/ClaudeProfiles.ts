// What the settings screen's IPC calls do: list the Claude profiles in the install home with their
// ticks, and tick or untick one by name through the engine in packages/shared/src/install-skills.ts. The page
// is untrusted input, so a call must come from the board's page, a name must look like a profile
// folder and a tick must be a boolean.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { INSTALL_MANIFEST, isProfileName, listClaudeProfiles, setProfileTick } from "@mux-factory/shared/install-skills";
import type { ProfilesResult } from "@mux-factory/shared";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** `text` with each path in `home` written from `~`, as the page shows paths. */
const inHome = (text: string, home: string) => {
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`${escaped}(?=$|[/\\s:'",;)])`, "g"), "~");
};

/** True when `url`, the calling frame's address, is on the board's origin. */
export const fromBoard = (url: string | undefined, boardOrigin: string): boolean => {
  if (!url || !boardOrigin) return false;
  try {
    return new URL(url).origin === boardOrigin;
  } catch {
    return false;
  }
};

/** Every profile with its tick; `installed` is false until the app's first install. A failed read returns its error. */
export const list = (home: string): ProfilesResult => {
  const installed = NodeFS.existsSync(NodePath.join(home, ".agents", INSTALL_MANIFEST));
  try {
    return { profiles: listClaudeProfiles(home), installed, conflicts: [] };
  } catch (cause) {
    return { profiles: [], installed, conflicts: [], error: inHome(message(cause), home) };
  }
};

/** Ticks or unticks one profile at once; a refused or failed call leaves the profiles as they were. */
export const setTick = (home: string, name: unknown, ticked: unknown): ProfilesResult => {
  try {
    if (typeof name !== "string" || !isProfileName(name)) {
      throw new Error(`${String(name)} is not a Claude profile`);
    }
    if (typeof ticked !== "boolean") throw new Error("A tick must be true or false");
    const { conflicts, removed } = setProfileTick(home, name, ticked);
    return { ...list(home), conflicts: conflicts.map((path) => inHome(path, home)), removed };
  } catch (cause) {
    return { ...list(home), error: inHome(message(cause), home) };
  }
};
