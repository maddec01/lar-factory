// The window's size, position and maximized state, kept in a JSON file in the app's user data so the window
// reopens where it was left, maximized if it was. Full screen is not kept. From T3 Code's
// resolveInitialMainWindowBounds, windowFitsWithinDisplay and the bounds saving in
// apps/desktop/src/window/DesktopWindow.ts, and the mainWindowBounds and mainWindowMaximized settings in
// apps/desktop/src/settings/DesktopAppSettings.ts.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import type * as Electron from "electron";

export const MIN_MAIN_WINDOW_SIZE = { width: 1024, height: 700 } as const;
export const DEFAULT_MAIN_WINDOW_SIZE = { width: 1280, height: 860 } as const;
const MAIN_WINDOW_BOUNDS_PERSIST_DEBOUNCE_MS = 500;

export interface DesktopWindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface DesktopWindowState {
  readonly mainWindowBounds: DesktopWindowBounds | null;
  readonly mainWindowMaximized: boolean;
}

type DisplayBounds = Pick<Electron.Rectangle, "x" | "y" | "width" | "height">;

/** Whole-number bounds at least the minimum size, or null. */
function normalizeMainWindowBounds(value: unknown): DesktopWindowBounds | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const isInt = (n: unknown): n is number => Number.isInteger(n);
  return isInt(x) &&
    isInt(y) &&
    isInt(width) &&
    isInt(height) &&
    width >= MIN_MAIN_WINDOW_SIZE.width &&
    height >= MIN_MAIN_WINDOW_SIZE.height
    ? { x, y, width, height }
    : null;
}

function windowFitsWithinDisplay(windowBounds: DesktopWindowBounds, displayBounds: DisplayBounds): boolean {
  return (
    windowBounds.x >= displayBounds.x &&
    windowBounds.y >= displayBounds.y &&
    windowBounds.x + windowBounds.width <= displayBounds.x + displayBounds.width &&
    windowBounds.y + windowBounds.height <= displayBounds.y + displayBounds.height
  );
}

/** The saved bounds if they fit entirely inside one display; otherwise the default size, which Electron centres. */
export function resolveInitialMainWindowBounds(
  persistedBounds: DesktopWindowBounds | null,
  displays: readonly DisplayBounds[],
): DesktopWindowBounds | typeof DEFAULT_MAIN_WINDOW_SIZE {
  if (persistedBounds !== null && displays.some((display) => windowFitsWithinDisplay(persistedBounds, display))) {
    return persistedBounds;
  }
  return DEFAULT_MAIN_WINDOW_SIZE;
}

export interface WindowStateSetting {
  /** The saved state, or nothing saved when there is no file or it can't be read. */
  readonly read: Effect.Effect<DesktopWindowState>;
  /** Saves the state; a failure is logged, and the next launch opens where the last save left it. */
  readonly write: (bounds: DesktopWindowBounds, isMaximized: boolean) => Effect.Effect<void>;
}

export const atFile = (file: string): WindowStateSetting => ({
  read: Effect.sync(() => {
    try {
      const parsed = JSON.parse(NodeFS.readFileSync(file, "utf8")) as Partial<Record<keyof DesktopWindowState, unknown>>;
      const mainWindowBounds = normalizeMainWindowBounds(parsed?.mainWindowBounds);
      return { mainWindowBounds, mainWindowMaximized: mainWindowBounds !== null && parsed.mainWindowMaximized === true };
    } catch {
      return { mainWindowBounds: null, mainWindowMaximized: false };
    }
  }),
  write: (bounds, isMaximized) =>
    Effect.try(() => {
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, `${JSON.stringify({ mainWindowBounds: bounds, mainWindowMaximized: isMaximized })}\n`);
    }).pipe(Effect.catch((error) => Effect.logError(`could not save the window's bounds: ${String(error.cause)}`))),
});

/**
 * Saves the window's bounds 500 ms after it last moves, resizes, maximizes or unmaximizes, and at once when
 * the window closes. Returns the immediate save for quitting: the app exits without a close event.
 */
export const persistMainWindowBounds = (window: Electron.BrowserWindow, setting: WindowStateSetting) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const readPersistableBounds = (): DesktopWindowBounds | null => {
    if (window.isDestroyed()) return null;
    // Full screen, maximized and minimized keep the bounds the window returns to.
    const bounds =
      window.isFullScreen() || window.isMaximized() || window.isMinimized() ? window.getNormalBounds() : window.getBounds();
    return normalizeMainWindowBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  };
  const clearBoundsPersist = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const flushBoundsPersist = () => {
    clearBoundsPersist();
    const bounds = readPersistableBounds();
    if (bounds !== null) Effect.runSync(setting.write(bounds, window.isMaximized()));
  };
  const scheduleBoundsPersist = () => {
    clearBoundsPersist();
    timer = setTimeout(flushBoundsPersist, MAIN_WINDOW_BOUNDS_PERSIST_DEBOUNCE_MS);
  };
  window.on("resize", scheduleBoundsPersist);
  window.on("move", scheduleBoundsPersist);
  window.on("maximize", scheduleBoundsPersist);
  window.on("unmaximize", scheduleBoundsPersist);
  // Closing the window, or installing an update, closes it without before-quit.
  window.on("close", flushBoundsPersist);
  window.on("closed", clearBoundsPersist);
  return flushBoundsPersist;
};
