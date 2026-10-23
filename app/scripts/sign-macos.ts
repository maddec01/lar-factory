// electron-builder's mac.sign hook, copied from T3 Code's scripts/sign-macos.ts:
// signs with @electron/osx-sign, batching the codesign calls.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

export default async function sign(options: SignOptions): Promise<void> {
  await signApplication({ ...options, batchCodesignCalls: true });
}
