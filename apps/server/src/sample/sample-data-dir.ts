// Loaded before server composition: even a caller-supplied live data directory is ignored in sample mode.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.BOARD_DATA_FILE) {
    const directory = mkdtempSync(join(tmpdir(), 'lar-factory-sample-'));

    process.env.LAR_FACTORY_DATA_DIR = directory;
    process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
}
