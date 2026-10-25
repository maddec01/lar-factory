import { EventEmitter } from "node:events";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { afterEach, assert, beforeEach, describe, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Electron from "electron";

import { tempDir } from "../../test/support.ts";
import * as MainWindowBounds from "./MainWindowBounds.ts";

const laptop = { x: 0, y: 0, width: 1512, height: 982 };
const monitor = { x: 1512, y: 0, width: 2560, height: 1440 };

describe("resolveInitialMainWindowBounds", () => {
  it("keeps saved bounds that fit entirely inside one display", () => {
    const saved = { x: 1600, y: 100, width: 1400, height: 900 };
    assert.deepStrictEqual(MainWindowBounds.resolveInitialMainWindowBounds(saved, [laptop, monitor]), saved);
  });

  it("opens at the default size, centred, when the saved bounds were on a display that's gone", () => {
    const saved = { x: 1600, y: 100, width: 1400, height: 900 };
    assert.deepStrictEqual(MainWindowBounds.resolveInitialMainWindowBounds(saved, [laptop]), {
      width: 1280,
      height: 860,
    });
  });

  it("opens at the default size when the saved bounds are larger than every display", () => {
    const saved = { x: 0, y: 0, width: 4000, height: 1440 };
    assert.deepStrictEqual(MainWindowBounds.resolveInitialMainWindowBounds(saved, [laptop, monitor]), {
      width: 1280,
      height: 860,
    });
  });

  it("opens at the default size when the saved bounds straddle two displays", () => {
    const saved = { x: 1000, y: 0, width: 1100, height: 800 };
    assert.deepStrictEqual(MainWindowBounds.resolveInitialMainWindowBounds(saved, [laptop, monitor]), {
      width: 1280,
      height: 860,
    });
  });

  it("opens at the default size with nothing saved", () => {
    assert.deepStrictEqual(MainWindowBounds.resolveInitialMainWindowBounds(null, [laptop]), {
      width: 1280,
      height: 860,
    });
  });
});

const tempFile = () => NodePath.join(tempDir("window-state-"), "settings", "window-state.json");

describe("MainWindowBounds.atFile", () => {
  it.effect("reads nothing before a save, then the bounds and maximized state last written", () =>
    Effect.gen(function* () {
      const file = tempFile();
      assert.deepStrictEqual(yield* MainWindowBounds.atFile(file).read, {
        mainWindowBounds: null,
        mainWindowMaximized: false,
      });
      const bounds = { x: 10, y: 20, width: 1300, height: 900 };
      yield* MainWindowBounds.atFile(file).write(bounds, true);
      assert.deepStrictEqual(yield* MainWindowBounds.atFile(file).read, {
        mainWindowBounds: bounds,
        mainWindowMaximized: true,
      });
    }),
  );

  it.effect("reads a broken file, or bounds below the minimum size, as nothing saved", () =>
    Effect.gen(function* () {
      const file = tempFile();
      const nothing = { mainWindowBounds: null, mainWindowMaximized: false };
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, "not json");
      assert.deepStrictEqual(yield* MainWindowBounds.atFile(file).read, nothing);
      NodeFS.writeFileSync(
        file,
        JSON.stringify({ mainWindowBounds: { x: 0, y: 0, width: 800, height: 900 }, mainWindowMaximized: true }),
      );
      assert.deepStrictEqual(yield* MainWindowBounds.atFile(file).read, nothing);
    }),
  );
});

/** A window that only moves when told, and a setting that keeps what it was asked to save. */
const fakeWindow = () => {
  const window = Object.assign(new EventEmitter(), {
    bounds: { x: 10, y: 20, width: 1300, height: 900 },
    normalBounds: { x: 100, y: 200, width: 1200, height: 800 },
    destroyed: false,
    fullScreen: false,
    maximized: false,
    minimized: false,
    isDestroyed: () => window.destroyed,
    isFullScreen: () => window.fullScreen,
    isMaximized: () => window.maximized,
    isMinimized: () => window.minimized,
    getBounds: () => window.bounds,
    getNormalBounds: () => window.normalBounds,
  });
  const writes: Array<{ bounds: MainWindowBounds.DesktopWindowBounds; isMaximized: boolean }> = [];
  const setting: MainWindowBounds.WindowStateSetting = {
    read: Effect.succeed({ mainWindowBounds: null, mainWindowMaximized: false }),
    write: (bounds, isMaximized) => Effect.sync(() => void writes.push({ bounds, isMaximized })),
  };
  const flush = MainWindowBounds.persistMainWindowBounds(window as unknown as Electron.BrowserWindow, setting);
  return { window, writes, flush };
};

describe("persistMainWindowBounds", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("saves once, 500 ms after the window last moves or resizes", () => {
    const { window, writes } = fakeWindow();
    window.emit("move");
    vi.advanceTimersByTime(400);
    window.emit("resize");
    vi.advanceTimersByTime(499);
    assert.deepStrictEqual(writes, []);
    vi.advanceTimersByTime(1);
    assert.deepStrictEqual(writes, [{ bounds: window.bounds, isMaximized: false }]);
  });

  it("saves the bounds the window returns to while maximized, full screen or minimized", () => {
    const { window, writes, flush } = fakeWindow();
    window.maximized = true;
    window.emit("maximize");
    vi.advanceTimersByTime(500);
    window.maximized = false;
    window.fullScreen = true;
    flush();
    window.fullScreen = false;
    window.minimized = true;
    flush();
    assert.deepStrictEqual(writes, [
      { bounds: window.normalBounds, isMaximized: true },
      { bounds: window.normalBounds, isMaximized: false },
      { bounds: window.normalBounds, isMaximized: false },
    ]);
  });

  it("saves at once when the window closes, and not again after it's gone", () => {
    const { window, writes } = fakeWindow();
    window.emit("resize");
    window.emit("close");
    assert.deepStrictEqual(writes, [{ bounds: window.bounds, isMaximized: false }]);
    window.emit("move");
    window.emit("closed");
    vi.advanceTimersByTime(500);
    assert.strictEqual(writes.length, 1);
  });

  it("saves nothing for a destroyed window", () => {
    const { window, writes, flush } = fakeWindow();
    window.emit("resize");
    window.destroyed = true;
    vi.advanceTimersByTime(500);
    flush();
    assert.deepStrictEqual(writes, []);
  });
});
