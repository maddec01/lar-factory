// The board's own `~/env` for the Copies (pingdotgg/t3code apps/web/src/env.ts at d53873b). The board app's
// preload sets window.boardApp, where T3's sets window.desktopBridge, before any page code runs.

export const isElectron = typeof window !== 'undefined' && 'boardApp' in window;
