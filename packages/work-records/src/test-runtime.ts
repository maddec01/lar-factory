import { boardDataDir } from '@lar-factory/shared/data-dir';
import type { TestRuntime as Runtime } from '@lar-factory/shared/run-settings';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';

import { checkCommand } from './check-runner.ts';
import { trapTermination } from './process-group.ts';
import { openWorkRecords, workRecordsPath } from './work-records.ts';

function runtimeEnv(runtime: Runtime | undefined): NodeJS.ProcessEnv {
    if (
        !runtime ||
        typeof runtime.node !== 'string' ||
        typeof runtime.version !== 'string' ||
        !isAbsolute(runtime.node) ||
        !/^v\d+\.\d+\.\d+$/.test(runtime.version)
    )
        throw new Error('Build held: no valid frozen test runtime.');

    const actual = execFileSync(runtime.node, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();

    if (actual !== runtime.version)
        throw new Error(
            `Build held: frozen test runtime mismatch: expected ${runtime.version}, found ${actual}. Tests were not executed.`,
        );

    const env = { ...process.env, PATH: `${dirname(runtime.node)}${delimiter}${process.env.PATH ?? ''}` };
    const resolved = execFileSync('node', ['-p', 'process.execPath'], { env, encoding: 'utf8', timeout: 10000 }).trim();

    if (realpathSync(resolved) !== realpathSync(runtime.node))
        throw new Error('Build held: frozen runtime must provide node in its own bin directory.');

    return env;
}

/** The same checked local runtime wraps focused tests and recorded suites, for every build role. */
export async function testRuntimeCommand(args: string[]): Promise<number> {
    try {
        const separator = args.indexOf('--');
        const { values, positionals } = parseArgs({
            args: args.slice(0, separator < 0 ? undefined : separator),
            allowPositionals: true,
            options: {
                'data-dir': { type: 'string' },
                role: { type: 'string' },
                'run-id': { type: 'string' },
                record: { type: 'boolean' },
                live: { type: 'boolean' },
                reason: { type: 'string' },
            },
        });

        if (positionals.length !== 1) throw new Error('Name a work ID (run-test).');

        const dir = values['data-dir'] ?? boardDataDir();
        const words = separator < 0 ? [] : args.slice(separator + 1);

        if (!words.length || !values.role) throw new Error('Expected run-test ID --role ROLE [--record] -- COMMAND.');

        const records = await openWorkRecords(workRecordsPath(dir));
        let env: NodeJS.ProcessEnv;

        try {
            env = runtimeEnv(records.testRuntime(positionals[0]!, values['run-id'] ?? process.env.LAR_FACTORY_RUN_ID));
        } finally {
            records.close();
        }

        if (values.record) {
            const prior = process.env.PATH;

            process.env.PATH = env.PATH;

            try {
                return await checkCommand([
                    'run-check',
                    positionals[0]!,
                    '--role',
                    values.role,
                    '--data-dir',
                    dir,
                    ...(values.live ? ['--live'] : []),
                    ...(values.reason ? ['--reason', values.reason] : []),
                    '--',
                    ...words,
                ]);
            } finally {
                process.env.PATH = prior;
            }
        }

        const termination = trapTermination();

        try {
            const result = await termination.run(words, { env, stdio: 'inherit' });

            return result.code ?? 1;
        } finally {
            termination.dispose();
        }
    } catch (error) {
        process.stderr.write(`lar-work: build held: test runtime: ${(error as Error).message}\n`);

        return 1;
    }
}
