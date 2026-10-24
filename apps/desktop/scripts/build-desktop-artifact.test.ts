import { describe, expect, it } from "@effect/vitest";

import {
  buildEnvironment,
  createBuildConfig,
  missingSigningVariables,
  parseBuildArgs,
  updateFeedFile,
} from "./build-desktop-artifact.ts";

const signingEnv = {
  CSC_LINK: "certificate",
  CSC_KEY_PASSWORD: "password",
  APPLE_API_KEY: "/tmp/AuthKey_ABC.p8",
  APPLE_API_KEY_ID: "ABC",
  APPLE_API_ISSUER: "issuer",
  APPLE_TEAM_ID: "TEAM123456",
};

describe("createBuildConfig", () => {
  it("builds an Apple Silicon dmg and zip as the given version", () => {
    const config = createBuildConfig({ version: "0.1.0", signed: false, outputDir: "/out" });

    expect(config.mac?.target).toEqual([
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ]);
    expect(config.extraMetadata).toEqual({ version: "0.1.0" });
    expect(config.directories?.output).toBe("/out");
    expect(config.artifactName).not.toContain(" ");
  });

  it("points a Nightly at the nightly channel of mux-factory's prereleases", () => {
    const config = createBuildConfig({
      version: "0.1.0-nightly.20261023.57",
      signed: false,
      outputDir: "/out",
    });

    expect(config.publish).toEqual([
      {
        provider: "github",
        owner: "maddec01",
        repo: "mux-factory",
        releaseType: "prerelease",
        channel: "nightly",
      },
    ]);
  });

  it("points a Stable Release at mux-factory's latest releases", () => {
    const config = createBuildConfig({ version: "0.1.0", signed: false, outputDir: "/out" });

    expect(config.publish).toEqual([
      { provider: "github", owner: "maddec01", repo: "mux-factory", releaseType: "release" },
    ]);
  });

  it("ships the bundled server, the built page and config.json where the server finds them", () => {
    const config = createBuildConfig({ version: "0.1.0", signed: false, outputDir: "/out" });

    expect(config.extraResources).toEqual(expect.arrayContaining([
      { from: "dist-electron/server", to: "server/dist" },
      { from: "../web/dist", to: "web/dist" },
      { from: "../../config.json", to: "config.json" },
    ]));
    expect(config.files).toContain("!dist-electron/server/**/*");
  });

  it("signs with hardened runtime and notarizes when signed", () => {
    const mac = createBuildConfig({ version: "0.1.0", signed: true, outputDir: "/out" }).mac;

    expect(mac).not.toHaveProperty("identity");
    expect(mac?.hardenedRuntime).toBe(true);
    expect(mac?.notarize).toBe(true);
    expect(mac?.sign).toMatch(/scripts\/sign-macos\.ts$/);
  });

  it("skips signing and notarizing when unsigned", () => {
    const mac = createBuildConfig({ version: "0.1.0", signed: false, outputDir: "/out" }).mac;

    expect(mac?.identity).toBeNull();
    expect(mac?.notarize).toBe(false);
    expect(mac).not.toHaveProperty("sign");
  });
});

describe("updateFeedFile", () => {
  it("names the feed after the version's channel", () => {
    expect(updateFeedFile("0.1.0-nightly.20261023.57")).toBe("nightly-mac.yml");
    expect(updateFeedFile("0.1.0")).toBe("latest-mac.yml");
  });
});

describe("missingSigningVariables", () => {
  it("lists every signing variable that is unset or empty", () => {
    expect(missingSigningVariables({ ...signingEnv, CSC_LINK: "", APPLE_TEAM_ID: undefined })).toEqual([
      "CSC_LINK",
      "APPLE_TEAM_ID",
    ]);
    expect(missingSigningVariables(signingEnv)).toEqual([]);
  });
});

describe("buildEnvironment", () => {
  it("drops empty variables, which electron-builder reads as set", () => {
    expect(buildEnvironment({ ...signingEnv, CSC_NAME: "" }, true)).toEqual(signingEnv);
  });

  it("removes the signing variables and keychain lookup for an unsigned build", () => {
    expect(buildEnvironment({ ...signingEnv, PATH: "/bin" }, false)).toEqual({
      APPLE_TEAM_ID: "TEAM123456",
      PATH: "/bin",
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    });
  });
});

describe("parseBuildArgs", () => {
  it("signs by default and takes the version and output folder", () => {
    expect(parseBuildArgs(["--build-version", "0.2.0", "--output-dir", "../release-assets"])).toEqual({
      version: "0.2.0",
      signed: true,
      outputDir: "../release-assets",
    });
  });

  it("builds unsigned with --unsigned, leaving the version to package.json", () => {
    expect(parseBuildArgs(["--unsigned"])).toEqual({ version: undefined, signed: false, outputDir: "release" });
  });
});
