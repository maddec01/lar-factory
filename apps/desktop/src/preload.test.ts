import { mkdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import type { BoardAppBridge, InstallSnapshot } from "@lar-factory/shared";
import { makeBundle, tempDir } from "../test/support.ts";
import { makeChecks } from "./skills/skill-install.ts";
import { boardPageOnly, makeInstallBoard } from "./skills/install-board.ts";
import { runInstall } from "./skills/install-runner.ts";
import * as IpcChannels from "./ipc-channels.ts";

const ipc = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: ipc.expose },
  ipcRenderer: { ...ipc, sendSync: () => undefined },
}));

describe("install progress through preload", () => {
  it("delivers intermediate work while the real copy is paused, remains responsive, and recovers its snapshot", async () => {
    const events = new EventEmitter();
    ipc.on.mockImplementation((channel, listener) => events.on(channel, listener));
    ipc.removeListener.mockImplementation((channel, listener) => events.removeListener(channel, listener));
    await import("./preload.ts");
    const bridge = ipc.expose.mock.calls[0]![1] as BoardAppBridge;
    const home = tempDir("live-install-");
    const bundle = makeBundle();
    const gate = new Int32Array(new SharedArrayBuffer(4));
    let worker: Worker | undefined;
    let paused!: () => void;
    const pause = new Promise<void>((resolve) => { paused = resolve; });
    const checks = (await Effect.runPromise(makeChecks({ home, bundle, version: "1.0.0", isPackaged: true, argv: [], env: {} },
      () => Effect.succeed({ available: false, reason: "not-running" }), (work, progress) => {
        worker = new Worker(join(import.meta.dirname, "skills/install-worker.ts"), {
          workerData: { ...work, gate: gate.buffer }, execArgv: ["--import", join(import.meta.dirname, "../test/pause-copy.mjs")],
        });
        worker.on("message", (message) => { if (message.paused) paused(); });
        worker.on("error", paused);
        return runInstall(work, progress, worker);
      })))!;
    const board = makeInstallBoard({ home, bundle, version: "1.0.0" }, checks);
    ipc.invoke.mockImplementation(async (channel, ...args) => {
      if (channel === IpcChannels.INSTALL_GET_STATE) return board.snapshot();
      if (channel === IpcChannels.INSTALL_CLOSE_OVERVIEW) return board.closeOverview(args[0], args[1]);
      throw new Error(`Unexpected operation ${channel}`);
    });
    const stop = board.subscribe((snapshot) => events.emit(IpcChannels.INSTALL_STATE, {}, snapshot));
    const sent: InstallSnapshot[] = [];
    const unlisten = bridge.onInstallState((snapshot) => sent.push(snapshot));
    let finished = false;
    const installing = Effect.runPromise(checks.atLaunch).then(() => { finished = true; });
    try {
      await pause;
      expect(sent.at(-1)?.targets[0]?.skills).toEqual([{ name: "lar-work", state: "installing" }]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(finished).toBe(false);
      expect((await bridge.getInstallState()).targets[0]?.skills).toEqual([{ name: "lar-work", state: "installing" }]);
      const progress = await bridge.getInstallState();
      expect((await bridge.closeInstallOverview("dismissed", progress.revision!)).overview).toBe("dismissed");
      expect(finished).toBe(false);
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      await installing;
      expect(sent.at(-1)?.targets[0]?.skills).toEqual([{ name: "lar-work", state: "installed" }]);
      unlisten();
      expect(await bridge.getInstallState()).toEqual(board.snapshot());
      expect((await bridge.getInstallState()).overview).toBe("dismissed");
      expect(ipc.invoke.mock.calls.every(([channel]) => [IpcChannels.INSTALL_GET_STATE, IpcChannels.INSTALL_CLOSE_OVERVIEW].includes(channel))).toBe(true);
    } finally {
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      await installing;
      await worker?.terminate();
      unlisten();
      stop();
    }
  });
});

it("forwards the board's readiness signal through the install mutation channel", async () => {
  vi.resetModules();
  await import("./preload.ts");
  const bridge = ipc.expose.mock.calls.at(-1)![1] as BoardAppBridge;
  ipc.invoke.mockResolvedValueOnce(undefined);
  await bridge.boardReady();
  expect(ipc.invoke).toHaveBeenLastCalledWith(IpcChannels.INSTALL_BOARD_READY);
});

it.each(["automatic", "dismissed"] as const)("forwards %s overview closure with the displayed revision", async (reason) => {
  vi.resetModules();
  await import("./preload.ts");
  const bridge = ipc.expose.mock.calls.at(-1)![1] as BoardAppBridge;
  ipc.invoke.mockResolvedValueOnce({ overview: reason, revision: 8 });
  expect(await bridge.closeInstallOverview(reason, 7)).toEqual({ overview: reason, revision: 8 });
  expect(ipc.invoke).toHaveBeenLastCalledWith(IpcChannels.INSTALL_CLOSE_OVERVIEW, reason, 7);
});

it.each(["automatic", "dismissed"] as const)("recovers %s closure through page reload and a board-server restart without another install", async (reason) => {
  const home = tempDir("overview-recovery-");
  mkdirSync(join(home, ".claude"));
  const bundle = makeBundle();
  const run = vi.fn(runInstall);
  const checks = (await Effect.runPromise(makeChecks({ home, bundle, version: "1.0.0", isPackaged: true, argv: [], env: {} },
    () => Effect.succeed({ available: false, reason: "not-running" }), run)))!;
  const board = makeInstallBoard({ home, bundle, version: "1.0.0" }, checks);
  let origin = "http://127.0.0.1:4319";
  let caller = `${origin}/`;
  const requireBoard = boardPageOnly(() => origin, "Only the current board page can change the install");
  ipc.invoke.mockImplementation(async (channel, ...args) => {
    requireBoard(caller);
    if (channel === IpcChannels.INSTALL_GET_STATE) return board.snapshot();
    if (channel === IpcChannels.INSTALL_CLOSE_OVERVIEW) return board.closeOverview(args[0], args[1]);
    throw new Error(`Unexpected operation ${channel}`);
  });
  await Effect.runPromise(checks.atLaunch);
  vi.resetModules();
  await import("./preload.ts");
  const first = ipc.expose.mock.calls.at(-1)![1] as BoardAppBridge;
  const completed = await first.getInstallState();
  const closed = await first.closeInstallOverview(reason, completed.revision!);
  expect(closed.overview).toBe(reason);
  expect(closed.targets[0]?.skills).toEqual([{ name: "lar-work", state: "installed" }]);

  vi.resetModules();
  await import("./preload.ts");
  const reloaded = ipc.expose.mock.calls.at(-1)![1] as BoardAppBridge;
  expect(await reloaded.getInstallState()).toEqual(closed);
  origin = "";
  await expect(reloaded.getInstallState()).rejects.toThrow("Only the current board page");
  origin = "http://127.0.0.1:4320";
  await expect(reloaded.closeInstallOverview(reason, closed.revision!)).rejects.toThrow("Only the current board page");
  caller = `${origin}/`;
  expect(await reloaded.getInstallState()).toEqual(closed);
  expect(run).toHaveBeenCalledOnce();
});
