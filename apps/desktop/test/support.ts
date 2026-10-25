// Fixtures the app's tests share.

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** A new empty folder in the system's temp folder. */
export const tempDir = (prefix: string) => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));

/** A bundle with one skill and one checklist, as the app's build copies them. */
export const makeBundle = () => {
  const bundle = tempDir("skill-bundle-");
  NodeFS.mkdirSync(NodePath.join(bundle, "skills/lar-work"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(bundle, "skills/lar-work/SKILL.md"), "# lar-work\n");
  NodeFS.mkdirSync(NodePath.join(bundle, "references"));
  NodeFS.writeFileSync(NodePath.join(bundle, "references/checklist.md"), "- [ ] check\n");
  return bundle;
};
