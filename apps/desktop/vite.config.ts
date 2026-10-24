// Builds the main process and preload to CommonJS in dist-electron/, as T3 Code's
// apps/desktop/vite.config.ts does, and bundles the board server into
// dist-electron/server/server.mjs for the packaged app, which has no node_modules.
// The dev window runs apps/server/src/server.ts as source.
import { defineConfig } from "vite-plus";

const electronOnly = (id: string) => id === "electron" || id.startsWith("electron/");

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
      // The skills and checklists of the commit being built, which the app installs on launch.
      copy: [
        { from: "../../skills", to: "dist-electron/bundle" },
        { from: "../../references", to: "dist-electron/bundle" },
      ],
      deps: {
        alwaysBundle: (id) => !id.startsWith("node:") && !electronOnly(id),
        neverBundle: electronOnly,
        onlyBundle: false,
      },
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
      // .ts files @mux-factory/shared exports, and the packaged app has no node_modules.
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
  ],
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
