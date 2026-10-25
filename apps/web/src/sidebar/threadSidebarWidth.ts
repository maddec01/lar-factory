// The sidebar's width rules, from T3 Code's apps/web/src/components/threadSidebarWidth.ts at d53873b, keeping T3's
// names: at least 208 px or the brand row, at most what leaves the main area 640 px, and the width in localStorage.
// The board's default is 300 px, not T3's 256 px, and the key is the board's own.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see apps/desktop/LICENSE.

export const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = 'lar_board_sidebar_width';
const THREAD_SIDEBAR_DEFAULT_WIDTH = 300;
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
export const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function resolveThreadSidebarMinimumWidth(brandWidth: number): number {
  return Math.max(THREAD_SIDEBAR_MIN_WIDTH, Math.ceil(brandWidth));
}

export function resolveThreadSidebarMaximumWidth(viewportWidth: number, minimumWidth = THREAD_SIDEBAR_MIN_WIDTH): number {
  return Math.max(minimumWidth, Math.floor(viewportWidth) - THREAD_MAIN_CONTENT_MIN_WIDTH);
}

export function clampThreadSidebarWidth(width: number, minimumWidth: number, maximumWidth: number): number {
  return Math.min(maximumWidth, Math.max(minimumWidth, width));
}

export function resolveInitialThreadSidebarWidth(storedWidth: number | null, viewportWidth: number): number {
  const preferredWidth = storedWidth === null ? THREAD_SIDEBAR_DEFAULT_WIDTH : Math.max(THREAD_SIDEBAR_MIN_WIDTH, storedWidth);
  return Math.min(preferredWidth, resolveThreadSidebarMaximumWidth(viewportWidth));
}
