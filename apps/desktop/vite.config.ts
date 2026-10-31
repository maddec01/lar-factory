// Builds the main process and preload to CommonJS in dist-electron/, as T3 Code's
// apps/desktop/vite.config.ts does, and bundles the board server into
// dist-electron/server/server.mjs and the lar-work command into dist-electron/work-records/lar-work.mjs for the
// packaged app, which has no node_modules. The dev window runs apps/server/src/server.ts as source.
import { compiledCss } from "@lar-factory/ui/compiled-css";
import { defineConfig, type UserConfig } from "vite-plus";
import { sharedTest } from "../../vitest.shared.ts";

const electronOnly = (id: string) => id === "electron" || id.startsWith("electron/");

/**
 * The lar-work command as one ES module with every dependency in it, which the launcher runs with the app's own Node.
 * Its tests build it on its own.
 */
export const larWorkPack = {
  format: "esm",
  outDir: "dist-electron/work-records",
  dts: false,
  sourcemap: false,
  outExtensions: () => ({ js: ".mjs" }),
  outputOptions: { codeSplitting: false },
  entry: { "lar-work": "../../packages/work-records/src/cli.ts" },
  clean: false,
  deps: {
    alwaysBundle: (id) => !id.startsWith("node:"),
    onlyBundle: false,
  },
} satisfies NonNullable<UserConfig["pack"]>;

export default defineConfig({
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      outputOptions: { codeSplitting: false },
      entry: ["src/main.ts"],
      clean: true,
      plugins: [compiledCss()],
      // The skills and checklists of the commit being built, which the app installs on launch, and
      // UPSTREAM.md, which credits them in Settings > Skills. tsdown copies a folder into `to` under its own name,
      // so the skills land in dist-electron/bundle/skills; `clean` empties dist-electron first.
      copy: [
        { from: "../../.assembled-skills/skills", to: "dist-electron/bundle" },
        { from: "../../UPSTREAM.md", to: "dist-electron/bundle" },
        { from: "../../THIRD_PARTY_NOTICES.md", to: "dist-electron/bundle" },
      ],
      deps: {
        alwaysBundle: (id) => !id.startsWith("node:") && !electronOnly(id),
        neverBundle: electronOnly,
        onlyBundle: false,
      },
    },
    {
      // The ownership engine has its own entry so synchronous filesystem work stays off the main thread.
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      outputOptions: { codeSplitting: false },
      entry: { "install-worker": "src/skills/install-worker.ts" },
      clean: false,
      deps: { alwaysBundle: (id) => !id.startsWith("node:"), onlyBundle: false },
    },
    {
      // Sandboxed preloads must be self-contained, without shared runtime chunks.
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preload.ts"],
      clean: false,
      deps: { neverBundle: electronOnly },
    },
    {
      // One ES module with every dependency in it; Node can't strip the types of the
      // .ts files @lar-factory/shared exports, and the packaged app has no node_modules.
      format: "esm",
      outDir: "dist-electron/server",
      dts: false,
      sourcemap: false,
      outExtensions: () => ({ js: ".mjs" }),
      outputOptions: { codeSplitting: false },
      entry: { server: "../server/src/server.ts" },
      clean: false,
      deps: {
        alwaysBundle: (id) => !id.startsWith("node:"),
        onlyBundle: false,
      },
    },
    larWorkPack,
  ],
  plugins: [compiledCss()],
  test: {
    ...sharedTest,
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
