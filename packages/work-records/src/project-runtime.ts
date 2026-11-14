import { isRecord } from '@lar-factory/shared';
import type { TestRuntime } from '@lar-factory/shared/run-settings';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Only local app data and the board environment participate; repository files never do. */
export function resolveTestRuntime(dir: string, repository: string): TestRuntime {
    const file = join(dir, 'project-runtimes.json');
    const settings: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

    if (!isRecord(settings)) throw new Error('Invalid local project runtime settings.');

    const key = repository.toLowerCase();
    // Desktop's process.execPath is Electron. Resolve the Node that checks would execute in the board environment.
    let runtime: unknown;

    try {
        runtime = Object.hasOwn(settings, key)
            ? settings[key]
            : JSON.parse(
                  execFileSync('node', ['-p', 'JSON.stringify({node:process.execPath,version:process.version})'], {
                      encoding: 'utf8',
                      timeout: 10000,
                  }),
              );
    } catch (error) {
        throw new Error(`Run held: board test runtime unavailable: ${(error as Error).message}`);
    }

    if (
        !isRecord(runtime) ||
        typeof runtime.node !== 'string' ||
        !isAbsolute(runtime.node) ||
        typeof runtime.version !== 'string' ||
        !/^v\d+\.\d+\.\d+$/.test(runtime.version)
    )
        throw new Error('Invalid saved project runtime; run held before launch.');

    return { node: runtime.node, version: runtime.version };
}
