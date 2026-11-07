// lar-work heavy: runs a heavy command once it holds a slot, so no more heavy commands run at once on this machine
// than the heavy command limit allows. Slots are owner files in the data folder, shared by every build, shaping task,
// project and worktree that uses it. A slot problem never stops the command.

import { boardDataDir } from '@lar-factory/shared/data-dir';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { automaticHeavyCommandLimit, readHeavyCommandLimit } from './heavy-command-limit.ts';
import {
    claimPath,
    ownerAt,
    ownsProcess,
    processIdentity,
    releasePath,
    writeOwnerFile,
    type Owner,
} from './owner-file.ts';
import { signalStatus, trapTermination } from './process-group.ts';

/** Names the data folder whose slot an ancestor command holds, so a nested heavy command doesn't wait on itself. */
const HOLDER_ENV = 'LAR_WORK_HEAVY_SLOT';
/** How often a waiter checks for a free slot. Tests shorten it. */
const checkEvery = () => Number(process.env.LAR_WORK_HEAVY_CHECK_MS) || 3000;
const REPORT_EVERY_MS = 60_000;

interface SlotOwner extends Owner {
    folder: string;
    command: string[];
}
interface HeavySlot {
    /** The environment the command runs with. */
    env: NodeJS.ProcessEnv;
    release(): Promise<void>;
}

const slotName = /^slot-\d+$/;
const ownerFileName = /^slot\.owner\.(\d+)\./;
const describe = (holder: SlotOwner) => `  process ${holder.pid} in ${holder.folder}: ${holder.command.join(' ')}`;
const validSlotOwner = (owner: SlotOwner) =>
    typeof owner.folder === 'string' &&
    Array.isArray(owner.command) &&
    owner.command.every((word) => typeof word === 'string');

/**
 * The slots' live holders, and the slot files no owner can be read from, which no waiter claims or counts. Removes the
 * owner files of waiters that died before claiming a slot.
 */
async function readSlots(
    slots: string,
    warned: Set<string>,
): Promise<{ live: { name: string; owner: SlotOwner }[]; unreadable: Set<string> }> {
    const live = [];
    const unreadable = new Set<string>();
    const names = await readdir(slots);
    // Judged by the PID in the name alone, so a check stays cheap with many waiters. A reused PID keeps the file until
    // that process exits.
    for (const name of names) {
        const pid = ownerFileName.exec(name)?.[1];
        if (!pid) continue;
        try {
            process.kill(Number(pid), 0);
            continue;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
        }
        try {
            await unlink(join(slots, name));
        } catch {
            /* Another waiter removed it. */
        }
    }
    for (const name of names.filter((name) => slotName.test(name))) {
        let owner: SlotOwner | null;
        try {
            owner = await ownerAt<SlotOwner>(join(slots, name));
            if (owner && !validSlotOwner(owner))
                throw Error(`The lock ${join(slots, name)} has invalid ownership data.`);
        } catch (error) {
            unreadable.add(name);
            if (!warned.has(name))
                process.stderr.write(
                    `lar-work: ignoring unreadable heavy command slot ${name}: ${(error as Error).message}\n`,
                );
            warned.add(name);
            continue;
        }
        if (owner && (await ownsProcess(owner))) live.push({ name, owner });
    }
    return { live, unreadable };
}

/**
 * Waits for a slot in `dataDir` to run `command`, rereading the limit on each check. Settles with null when `cancelled`
 * settles first. A command inside one that holds a slot in the same data folder runs at once, as does one whose slot
 * folder can't be used, after a warning.
 */
export async function waitForHeavySlot(
    dataDir: string,
    command: string[],
    cancelled: Promise<unknown>,
): Promise<HeavySlot | null> {
    const dir = resolve(dataDir);
    const unheld: HeavySlot = { env: process.env, async release() {} };
    if (process.env[HOLDER_ENV] === dir) return unheld;
    const slots = join(dir, 'heavy-slots');
    const base = join(slots, 'slot');
    const owner: SlotOwner = { pid: process.pid, token: randomUUID(), folder: process.cwd(), command };
    let candidate: string | undefined;
    const discard = async () => {
        if (candidate)
            try {
                await unlink(candidate);
            } catch {
                /* Nothing more to clean. */
            }
    };
    let stop = false;
    void cancelled.then(() => {
        stop = true;
    });
    const began = Date.now();
    let reported = -Infinity;
    let problem: string | undefined;
    const warned = new Set<string>();
    try {
        owner.identity = await processIdentity(process.pid);
        await mkdir(slots, { recursive: true });
        candidate = await writeOwnerFile(base, owner);
        for (;;) {
            const setting = readHeavyCommandLimit(dir);
            if (setting.problem && setting.problem !== problem)
                process.stderr.write(`lar-work: ${setting.problem} Using Automatic.\n`);
            problem = setting.problem;
            const limit =
                setting.limit === 'automatic'
                    ? automaticHeavyCommandLimit(availableParallelism(), totalmem())
                    : setting.limit;
            const { live, unreadable } = await readSlots(slots, warned);
            let holders = live;
            for (let i = 0; i < limit + unreadable.size && holders.length < limit; i++) {
                const name = `slot-${i}`;
                const target = join(slots, name);
                if (
                    unreadable.has(name) ||
                    holders.some((holder) => holder.name === name) ||
                    !(await claimPath(base, owner, target))
                )
                    continue;
                // A waiter that claimed a slot below a lowered limit while older holders still run gives it back.
                holders = (await readSlots(slots, warned)).live;
                if (holders.length > limit) {
                    await releasePath(target, owner);
                    break;
                }
                process.stderr.write(
                    `lar-work: started after waiting ${Math.round((Date.now() - began) / 1000)}s for a heavy command slot.\n`,
                );
                return {
                    env: { ...process.env, [HOLDER_ENV]: dir },
                    async release() {
                        try {
                            await releasePath(target, owner);
                        } catch (error) {
                            process.stderr.write(
                                `lar-work: can't free heavy command slot ${target}: ${(error as Error).message}\n`,
                            );
                        }
                        await discard();
                    },
                };
            }
            if (stop) {
                await discard();
                return null;
            }
            if (Date.now() - reported >= REPORT_EVERY_MS) {
                reported = Date.now();
                process.stderr.write(
                    `lar-work: waiting for a heavy command slot; ${holders.length} of ${limit} in use:\n${holders.map((holder) => describe(holder.owner)).join('\n')}\n`,
                );
            }
            let timer: NodeJS.Timeout | undefined;
            await Promise.race([
                new Promise((done) => {
                    timer = setTimeout(done, checkEvery());
                }),
                cancelled,
            ]);
            clearTimeout(timer);
            if (stop) {
                await discard();
                return null;
            }
        }
    } catch (error) {
        await discard();
        process.stderr.write(
            `lar-work: can't use the heavy command slots in ${slots}: ${(error as Error).message}. Running without a slot.\n`,
        );
        return unheld;
    }
}

/** `lar-work heavy [--data-dir D] -- <command>`: exits with the command's status. */
export async function heavyCommand(args: string[]): Promise<number> {
    const separator = args.indexOf('--');
    const command = separator < 0 ? [] : args.slice(separator + 1);
    let dataDir: string;
    try {
        const { values } = parseArgs({
            args: args.slice(1, separator < 0 ? undefined : separator),
            options: { 'data-dir': { type: 'string' } },
        });
        if (!command.length) throw Error('heavy needs a command after --.');
        dataDir = values['data-dir'] ?? boardDataDir();
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\nRun lar-work --help for usage.\n`);
        return 2;
    }
    const termination = trapTermination();
    try {
        const slot = await waitForHeavySlot(dataDir, command, termination.signalled);
        if (!slot) return signalStatus(termination.signal!);
        try {
            return (await termination.run(command, { stdio: ['ignore', 'inherit', 'inherit'], env: slot.env })).code;
        } finally {
            await slot.release();
        }
    } finally {
        termination.dispose();
    }
}
