import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as ChannelSetting from "./ChannelSetting.ts";

const tempFile = () =>
  NodePath.join(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "update-channel-")), "settings", "update-channel.json");

describe("ChannelSetting", () => {
  it.effect("reads nothing before a choice, then the channel last written", () =>
    Effect.gen(function* () {
      const file = tempFile();
      assert.isNull(yield* ChannelSetting.atFile(file).read);
      yield* ChannelSetting.atFile(file).write("nightly");
      assert.strictEqual(yield* ChannelSetting.atFile(file).read, "nightly");
      yield* ChannelSetting.atFile(file).write("latest");
      assert.strictEqual(yield* ChannelSetting.atFile(file).read, "latest");
    }),
  );

  it.effect("reads a file that isn't a channel as no choice", () =>
    Effect.gen(function* () {
      const file = tempFile();
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, '{"channel":"beta"}');
      assert.isNull(yield* ChannelSetting.atFile(file).read);
      NodeFS.writeFileSync(file, "not json");
      assert.isNull(yield* ChannelSetting.atFile(file).read);
    }),
  );
});
