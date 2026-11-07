// The commit a new build branch starts from: the default branch's tip, fetched as the build starts.

import { log } from '../log.ts';
import { runTool } from '../tools/run-tool.ts';

const FETCH_TIMEOUT_MS = 120_000;

/** Single-quotes `word` for the shell Git runs its ssh command in. */
const quoted = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

/** The ssh command Git would run in `checkout`, in batch mode, as `BatchMode` is what stops ssh's own prompts. */
async function batchSsh(checkout: string, env: NodeJS.ProcessEnv): Promise<string> {
    const configured =
        env.GIT_SSH_COMMAND ||
        (
            await runTool('git', ['-C', checkout, 'config', '--get', 'core.sshCommand'], { env, timeout: 10_000 })
        ).stdout.trim() ||
        (env.GIT_SSH ? quoted(env.GIT_SSH) : 'ssh');
    return `${configured} -o BatchMode=yes`;
}

/**
 * Fetches `branch` from origin into `refs/remotes/origin/<branch>` and returns its commit. The explicit refspec updates
 * that ref on a clone with a narrow fetch refspec, and nothing here moves a local branch or the working tree. A commit,
 * unlike `origin/<branch>`, gives the branch T3 makes from it no upstream. Throws what to show the user; only the log
 * gets Git's detail.
 */
export async function fetchBaseCommit(
    checkout: string,
    branch: string,
    { env = process.env, timeout = FETCH_TIMEOUT_MS }: { env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<string> {
    const ref = `refs/remotes/origin/${branch}`;
    // Git skips every askpass program when GIT_ASKPASS is empty. Credential helpers still answer.
    const fetching = {
        ...env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        GIT_SSH_COMMAND: await batchSsh(checkout, env),
    };
    const { code, detail } = await runTool('git', ['-C', checkout, 'fetch', 'origin', `+refs/heads/${branch}:${ref}`], {
        env: fetching,
        timeout,
    });
    if (code !== 0) {
        log(`can't fetch ${branch} in ${checkout}: ${detail}`);
        throw new Error(
            code === null
                ? `Fetching ${branch} from origin took too long. Check the network, then start the build again.`
                : `Could not fetch ${branch} from origin. Check the network and your Git login, then start the build again.`,
        );
    }
    const commit = await runTool('git', ['-C', checkout, 'rev-parse', '--verify', `${ref}^{commit}`], {
        env,
        timeout: 10_000,
    });
    if (commit.code !== 0) throw new Error(`Could not read the fetched ${branch}. Start the build again.`);
    return commit.stdout.trim();
}
