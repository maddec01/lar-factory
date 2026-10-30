// The pack step's copy of the skills bundle. tsdown copies a `from` folder into `to` under the folder's own name, so
// the bundle's skills land at exactly dist-electron/bundle/skills/<skill>, never one folder deeper.
import assert from "node:assert/strict";
import * as NodePath from "node:path";

import { test } from "vite-plus/test";

import config from "../vite.config.ts";

test("the pack step copies the assembled skills to exactly dist-electron/bundle/skills", () => {
  const copies = [config.pack].flat().flatMap((pack) => [pack?.copy ?? []].flat());
  const skills = copies.flatMap((entry) =>
    typeof entry === "object" && "from" in entry && entry.from === "../../.assembled-skills/skills" ? [entry] : []);
  assert.equal(skills.length, 1);
  const { from, to } = skills[0]!;
  assert.equal(NodePath.join(String(to), NodePath.basename(String(from))), NodePath.join("dist-electron", "bundle", "skills"));
});
