// The bridge between the main process and the board's page, as T3 Code's
// apps/desktop/src/preload.ts. The page can tell from it that it runs in the app.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("boardApp", { platform: process.platform });
