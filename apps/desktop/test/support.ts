// Fixtures the app's tests share.

import * as NodeFS from 'node:fs';
import * as NodeOS from 'node:os';
import * as NodePath from 'node:path';

/** A new empty folder in the system's temp folder. */
export const tempDir = (prefix: string) => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
