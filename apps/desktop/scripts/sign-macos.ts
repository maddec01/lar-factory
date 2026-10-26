// electron-builder's mac.sign hook, copied from T3 Code's scripts/sign-macos.ts:
// signs with @electron/osx-sign, batching the codesign calls.
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

export default async function sign(options: SignOptions): Promise<void> {
  await signApplication({ ...options, batchCodesignCalls: true });
}
