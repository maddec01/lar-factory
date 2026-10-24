// The update channel chosen in Settings, kept in a JSON file in the app's user data so it
// survives a restart. Before a choice the app follows the installed version's channel.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import type { UpdateChannel } from "../../../web/src/app/board-app.ts";

export interface ChannelSetting {
  /** The chosen channel, or null before any choice or when the file can't be read. */
  readonly read: Effect.Effect<UpdateChannel | null>;
  /** Saves the choice; a failure is logged, and the next launch follows the installed version. */
  readonly write: (channel: UpdateChannel) => Effect.Effect<void>;
}

const isChannel = (value: unknown): value is UpdateChannel => value === "latest" || value === "nightly";

export const atFile = (file: string): ChannelSetting => ({
  read: Effect.sync(() => {
    try {
      const channel = (JSON.parse(NodeFS.readFileSync(file, "utf8")) as { channel?: unknown } | null)?.channel;
      return isChannel(channel) ? channel : null;
    } catch {
      return null;
    }
  }),
  write: (channel) =>
    Effect.try(() => {
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, `${JSON.stringify({ channel })}\n`);
    }).pipe(Effect.catch((error) => Effect.logError(`could not save the update channel: ${String(error.cause)}`))),
});
