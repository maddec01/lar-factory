// Packages the board app with electron-builder as an Apple Silicon dmg and zip,
// with the update feed for the version's channel. Cut down from T3 Code's
// scripts/build-desktop-artifact.ts (createBuildConfig, resolveGitHubPublishConfig
// and its build environment) to one Mac arm64 target.
//
// The build signs with the Developer ID certificate in CSC_LINK and
// CSC_KEY_PASSWORD, with hardened runtime, and notarizes and staples with the
// App Store Connect API key in APPLE_API_KEY (a .p8 file path), APPLE_API_KEY_ID
// and APPLE_API_ISSUER. Without them it fails; --unsigned builds without signing,
// for testing only.
//
//   node scripts/build-desktop-artifact.ts [--build-version <v>] [--output-dir <dir>] [--unsigned]
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import type { Configuration } from "electron-builder";

import type { UpdateChannel } from "@lar-factory/shared";
import { defaultChannel as updateChannel } from "../src/updates/updateMachine.ts";

const APP_DIR = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const UPDATE_REPOSITORY = { owner: "maddec01", repo: "lar-factory" } as const;

export const SIGNING_VARIABLES = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
  "APPLE_TEAM_ID",
] as const;

// Read by electron-builder and @electron/notarize; an unsigned build must not see them.
const SIGNING_ONLY_VARIABLES = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
] as const;

type Env = Readonly<Record<string, string | undefined>>;

export interface BuildOptions {
  readonly version: string;
  readonly signed: boolean;
  readonly outputDir: string;
}

// electron-builder names the feed after the publish config's channel.
export function updateFeedFile(version: string): string {
  return `${updateChannel(version)}-mac.yml`;
}

function publishConfig(channel: UpdateChannel) {
  return {
    provider: "github",
    ...UPDATE_REPOSITORY,
    releaseType: channel === "nightly" ? "prerelease" : "release",
    ...(channel === "nightly" ? { channel: "nightly" } : {}),
  } as const;
}

export function createBuildConfig({ version, signed, outputDir }: BuildOptions): Configuration {
  return {
    appId: "com.pedrogomes.lar.factory",
    productName: "lar Factory",
    // GitHub renames release assets with spaces, which breaks the feed's links.
    artifactName: "lar-factory-${version}-${arch}.${ext}",
    extraMetadata: { version },
    electronLanguages: ["en-US"],
    // No native modules to rebuild for Electron.
    npmRebuild: false,
    directories: { output: outputDir },
    // app.asar holds the main process and preload; vp pack bundled their dependencies.
    files: [
      "package.json",
      "dist-electron/**/*",
      "!**/*.map",
      // Goes to Resources/bundle below: Electron's fs can't copy a folder out of an asar.
      "!dist-electron/bundle/**/*",
      // Goes to Resources/server/dist below.
      "!dist-electron/server/**/*",
      // Bundled into dist-electron/main.cjs already.
      "!node_modules/**/*",
    ],
    // The board server, bundled into one file by vp pack, runs with Electron's Node
    // from Resources/, beside the page's build: it serves ../../web/dist from its own
    // file. Packaged, Electron's app path is Resources/app.asar, and
    // src/board-server/BoardServer.ts finds server/ and config.json beside it.
    extraResources: [
      { from: "dist-electron/server", to: "server/dist" },
      { from: "../web/dist", to: "web/dist" },
      { from: "dist-electron/bundle", to: "bundle" },
      { from: "../../config.json", to: "config.json" },
      // T3 Code's MIT licence: the main process, preload and scripts copy its code.
      { from: "LICENSE", to: "LICENSE.t3code.txt" },
    ],
    // The feed and the app's app-update.yml follow the version's channel.
    publish: [publishConfig(updateChannel(version))],
    mac: {
      target: [
        { target: "dmg", arch: ["arm64"] },
        { target: "zip", arch: ["arm64"] },
      ],
      category: "public.app-category.developer-tools",
      // lar-brand's icons/apple/Factory/Factory.icns.
      icon: "resources/icon.icns",
      notarize: signed,
      ...(signed
        ? { hardenedRuntime: true, sign: NodePath.join(APP_DIR, "scripts/sign-macos.ts") }
        : // Skip looking for a signing identity in the keychain.
          { identity: null }),
    },
  };
}

export function missingSigningVariables(env: Env): string[] {
  return SIGNING_VARIABLES.filter((name) => !env[name]);
}

// electron-builder reads several set-but-empty variables (CSC_LINK="") as set.
export function buildEnvironment(env: Env, signed: boolean): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value) result[key] = value;
  }
  if (!signed) {
    for (const name of SIGNING_ONLY_VARIABLES) delete result[name];
    result.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  }
  return result;
}

export interface BuildArgs {
  readonly version: string | undefined;
  readonly signed: boolean;
  readonly outputDir: string;
}

export function parseBuildArgs(argv: readonly string[]): BuildArgs {
  const { values } = NodeUtil.parseArgs({
    args: [...argv],
    options: {
      "build-version": { type: "string" },
      "output-dir": { type: "string", default: "release" },
      unsigned: { type: "boolean", default: false },
    },
  });
  return { version: values["build-version"], signed: !values.unsigned, outputDir: values["output-dir"] };
}

function fail(message: string): never {
  console.error(`build-desktop-artifact: ${message}`);
  process.exit(1);
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseBuildArgs(argv);
  if (args.signed) {
    const missing = missingSigningVariables(process.env);
    if (missing.length > 0) {
      fail(`${missing.join(", ")} not set. Set every signing variable, or pass --unsigned for a test build.`);
    }
    if (!NodeFS.existsSync(process.env.APPLE_API_KEY ?? "")) {
      fail("APPLE_API_KEY must be the path of the App Store Connect API key's .p8 file.");
    }
  }
  const packageJson = JSON.parse(NodeFS.readFileSync(NodePath.join(APP_DIR, "package.json"), "utf8")) as {
    version: string;
  };
  const version = args.version ?? packageJson.version;
  const outputDir = NodePath.resolve(APP_DIR, args.outputDir);

  // Replace the environment before electron-builder loads, as it reads process.env.
  const env = buildEnvironment(process.env, args.signed);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);

  const { build } = await import("electron-builder");
  await build({
    projectDir: APP_DIR,
    publish: "never",
    config: createBuildConfig({ version, signed: args.signed, outputDir }),
  });

  const feed = NodePath.join(outputDir, updateFeedFile(version));
  if (!NodeFS.existsSync(feed)) fail(`electron-builder wrote no update feed at ${feed}.`);
  console.log(`build-desktop-artifact: built ${version} (${args.signed ? "signed" : "unsigned"}) in ${outputDir}`);
}

if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
  });
}
