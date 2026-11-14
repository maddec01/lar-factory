import { isRecord } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { isRepo } from '@lar-factory/shared/repository-settings';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';

import { checkCommand } from './check-runner.ts';
import { trapTermination } from './process-group.ts';
import type { TestRuntime as Runtime } from './test-runtime-records.ts';
import { openWorkRecords, workRecordsPath } from './work-records.ts';

const settings = (dir: string): Record<string, Runtime> => {
    const file = join(dir, 'project-runtimes.json');
    const value: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

    if (!isRecord(value)) throw new Error('Invalid local project runtime settings.');

    return value as Record<string, Runtime>;
};

function runtimeEnv(runtime: Runtime | undefined): NodeJS.ProcessEnv {
    if (
        !runtime ||
        typeof runtime.node !== 'string' ||
        typeof runtime.version !== 'string' ||
        !isAbsolute(runtime.node) ||
        !/^v\d+\.\d+\.\d+$/.test(runtime.version)
    )
        throw new Error(
            'No valid project test runtime. Set it with lar-work test-runtime REPOSITORY --node /absolute/path/to/node --version vX.Y.Z; do not run tests until it is available.',
        );

    const actual = execFileSync(runtime.node, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();

    if (actual !== runtime.version)
        throw new Error(
            `Project test runtime changed: expected ${runtime.version}, found ${actual}. Stop and restore the configured runtime.`,
        );

    const env = { ...process.env, PATH: `${dirname(runtime.node)}${delimiter}${process.env.PATH ?? ''}` };
    const resolved = execFileSync('node', ['-p', 'process.execPath'], { env, encoding: 'utf8', timeout: 10000 }).trim();

    if (realpathSync(resolved) !== realpathSync(runtime.node))
        throw new Error('Configured runtime must provide node in its own bin directory.');

    return env;
}

/** The same checked local runtime wraps focused tests and recorded suites, for every build role. */
export async function testRuntimeCommand(command: string, args: string[]): Promise<number> {
    try {
        const separator = args.indexOf('--');
        const { values, positionals } = parseArgs({
            args: args.slice(0, separator < 0 ? undefined : separator),
            allowPositionals: true,
            options: {
                'data-dir': { type: 'string' },
                role: { type: 'string' },
                node: { type: 'string' },
                version: { type: 'string' },
                record: { type: 'boolean' },
                live: { type: 'boolean' },
                reason: { type: 'string' },
            },
        });

        if (positionals.length !== 1) throw new Error('Name a work ID (run-test) or repository (test-runtime).');

        const dir = values['data-dir'] ?? boardDataDir();
        const saved = settings(dir);

        if (command === 'test-runtime') {
            const repository = positionals[0]!.toLowerCase();

            if (!isRepo(repository)) throw new Error('Name a valid project repository.');

            if (values.node || values.version) {
                const runtime = { node: values.node!, version: values.version! };

                runtimeEnv(runtime);
                saved[repository] = runtime;
                mkdirSync(dir, { recursive: true });

                const file = join(dir, 'project-runtimes.json');
                const temp = `${file}.${process.pid}.tmp`;

                writeFileSync(temp, JSON.stringify(saved, null, 2), { mode: 0o600 });
                renameSync(temp, file);
            }

            runtimeEnv(saved[repository]);
            process.stdout.write(`${JSON.stringify(saved[repository])}\n`);

            return 0;
        }

        const words = separator < 0 ? [] : args.slice(separator + 1);

        if (!words.length || !values.role) throw new Error('Expected run-test ID --role ROLE [--record] -- COMMAND.');

        const records = await openWorkRecords(workRecordsPath(dir));
        let env: NodeJS.ProcessEnv;

        try {
            const repository = records.read(positionals[0]!).repository;
            const runtime = saved[repository.toLowerCase()];

            env = runtimeEnv(runtime);
            records.requireTestRuntime(positionals[0]!, runtime!);
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
        process.stderr.write(`lar-work: project test runtime: ${(error as Error).message}\n`);

        return 1;
    }
}
