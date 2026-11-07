// Repeats a memory run against a packaged board app: launches it from this terminal with the sampler on, captures
// `footprint` and `vmmap -summary` of the board server every 5 minutes after it starts, then quits it and writes the report.
//   pnpm run memory:run --app <path to Lar Factory.app> --out <new folder> [--minutes 30] [--force-gc]
//   pnpm run memory:run --report <folder>    writes the report again from a finished run's folder
// Quit the installed board first: the app allows one running copy. LAR_FACTORY_INSTALL_ROOT keeps the launch from
// rewriting ~/.local/bin/lar-work and the installed skills. Start no builds during a run, as they would name that folder.

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs, promisify } from 'node:util';

import { renderReport, type Capture } from './memory-report.ts';
import type { MemorySample } from './memory-sampler.ts';

const CAPTURE_MS = 300_000;
const FIRST_SAMPLE_MS = 60_000;
const SAMPLES = 'samples.jsonl';
const FOOTPRINT = /^capture-(\d+)\.footprint\.json$/;
const LAUNCHER = join(homedir(), '.local/bin/lar-work');

const run = promisify(execFile);

function readSamples(folder: string): MemorySample[] {
    const file = join(folder, SAMPLES);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as MemorySample);
}

function writeReport(folder: string): void {
    const captures: Capture[] = readdirSync(folder).flatMap((name) => {
        const match = FOOTPRINT.exec(name);
        return match ? [{ time: Number(match[1]), footprint: readFileSync(join(folder, name), 'utf8') }] : [];
    });
    const report = renderReport(readSamples(folder), captures);
    writeFileSync(join(folder, 'report.txt'), report);
    console.log(report);
}

async function capture(folder: string, pid: number): Promise<void> {
    const name = join(folder, `capture-${Date.now()}`);
    const tools: [string, () => Promise<unknown>][] = [
        ['footprint', () => run('footprint', ['-j', `${name}.footprint.json`, '-p', String(pid)])],
        [
            'vmmap',
            async () =>
                writeFileSync(
                    `${name}.vmmap.txt`,
                    (await run('vmmap', ['-summary', String(pid)], { maxBuffer: 2 ** 26 })).stdout,
                ),
        ],
    ];
    for (const [tool, take] of tools)
        await take().catch((error: unknown) => console.log(`${tool} failed: ${String(error)}`));
}

async function measure(app: string, folder: string, minutes: number, forceGc: boolean): Promise<void> {
    if (existsSync(folder)) throw new Error(`${folder} exists; each run takes a new folder`);
    mkdirSync(folder, { recursive: true });
    const launcherBefore = existsSync(LAUNCHER) ? readFileSync(LAUNCHER, 'utf8') : null;
    const { ELECTRON_RUN_AS_NODE: _, ...inherited } = process.env;
    const child = spawn(join(app, 'Contents/MacOS/Lar Factory'), [], {
        stdio: 'ignore',
        env: {
            ...inherited,
            BOARD_MEMORY_SAMPLES: join(folder, SAMPLES),
            ...(forceGc && { BOARD_MEMORY_FORCE_GC: '1' }),
            LAR_FACTORY_INSTALL_ROOT: join(folder, 'install-root'),
        },
    });
    let exited = false;
    child.once('exit', () => {
        exited = true;
    });
    const quit = () => {
        if (!exited) child.kill('SIGTERM');
    };
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.once(signal, () => {
            quit();
            process.exit(1);
        });

    try {
        const waitUntil = Date.now() + FIRST_SAMPLE_MS;
        while (!readSamples(folder).length) {
            if (exited || Date.now() > waitUntil)
                throw new Error('no sample arrived: quit the installed board and try again');
            await sleep(1_000);
        }
        const { pid } = readSamples(folder)[0]!;
        console.log(`board server PID ${pid}, samples in ${join(folder, SAMPLES)}`);
        const endAt = Date.now() + minutes * 60_000;
        // A capture as the server starts holds nothing, yet could sit nearest a peak in the first minutes.
        let nextCapture = Date.now() + CAPTURE_MS;
        let restarted = false;
        while (Date.now() < endAt && !exited) {
            if (readSamples(folder).some((sample) => sample.pid !== pid)) {
                console.log('the server restarted, which voids this run');
                restarted = true;
                break;
            }
            if (Date.now() >= nextCapture) {
                await capture(folder, pid);
                nextCapture += CAPTURE_MS;
            }
            await sleep(5_000);
        }
        if (exited) console.log('the app quit before the run ended');
        // Take a closing capture at the end of the run, before quitting.
        else if (!restarted) await capture(folder, pid);
    } finally {
        quit();
        while (!exited) await sleep(200);
    }
    const launcherAfter = existsSync(LAUNCHER) ? readFileSync(LAUNCHER, 'utf8') : null;
    console.log(
        launcherAfter === launcherBefore ? `${LAUNCHER} is unchanged` : `WARNING: ${LAUNCHER} changed during the run`,
    );
    writeReport(folder);
}

const { values } = parseArgs({
    options: {
        app: { type: 'string' },
        out: { type: 'string' },
        minutes: { type: 'string', default: '30' },
        'force-gc': { type: 'boolean', default: false },
        report: { type: 'string' },
    },
});
if (values.report) writeReport(resolve(values.report));
else if (values.app && values.out)
    await measure(resolve(values.app), resolve(values.out), Number(values.minutes), values['force-gc']);
else
    throw new Error(
        'usage: memory-run --app <path to Lar Factory.app> --out <new folder> [--minutes 30] [--force-gc], or --report <folder>',
    );
