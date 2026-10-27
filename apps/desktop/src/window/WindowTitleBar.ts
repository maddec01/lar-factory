// The window's title bar on a Mac: hidden, with the traffic lights inset into the page's 52 px top row, beside
// its brand (apps/web/src/title-bar/window-controls.tsx). From T3 Code's getWindowTitleBarOptions in
// apps/desktop/src/window/DesktopWindow.ts. On other systems the window keeps the system's title bar,
// and the page's top row sits below it.
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import type * as Electron from "electron";

const TOPBAR_HEIGHT = 52;
/** The traffic lights are 14 points tall. */
const WINDOW_BUTTON_RADIUS = 7;

export const options = (
  platform: NodeJS.Platform,
): Pick<Electron.BrowserWindowConstructorOptions, "titleBarStyle" | "trafficLightPosition"> =>
  platform === "darwin"
    ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: TOPBAR_HEIGHT / 2 - WINDOW_BUTTON_RADIUS } }
    : {};
