import { execFileSync } from 'node:child_process';

import type { ReviewDiff } from './reviewer-rules.ts';

/** Exact committed tree pair, independent of dirty files, rename heuristics, external diff and textconv tools. */
export function readReviewerDiff(base: string, head: string, cwd = process.cwd()) {
    if (![base, head].every((sha) => /^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(sha)))
        throw new Error('Reviewer selection requires full lowercase base and head commit SHAs.');

    const env: NodeJS.ProcessEnv = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };

    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_DIFF_OPTS'])
        delete env[key];

    const git = (args: string[]) =>
        new TextDecoder('utf-8', { fatal: true }).decode(
            execFileSync('git', ['--no-optional-locks', ...args], {
                cwd,
                env,
                maxBuffer: 16 * 1024 * 1024,
                timeout: 30_000,
                stdio: ['ignore', 'pipe', 'pipe'],
            }),
        );
    const root = git(['rev-parse', '--show-toplevel']).trim();

    for (const sha of [base, head]) {
        try {
            if (git(['rev-parse', '--verify', `${sha}^{commit}`]).trim() !== sha) throw new Error('Not a commit.');
        } catch {
            throw new Error(`Reviewer commit ${sha} is unavailable in the current checkout.`);
        }
    }

    const args = [
        '-C',
        root,
        '-c',
        'core.quotePath=false',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--no-color',
        '--text',
        '--inter-hunk-context=0',
        '--ignore-submodules=none',
        '--diff-algorithm=myers',
        '--no-indent-heuristic',
    ];
    const diff: ReviewDiff = { files: [], complete: true };
    let paths: string[];

    try {
        paths = [
            ...new Set(
                git([...args, '--name-only', '-z', base, head, '--'])
                    .split('\0')
                    .filter(Boolean),
            ),
        ].sort();
    } catch {
        return { root, diff: { files: [], complete: false } satisfies ReviewDiff };
    }

    for (const path of paths) {
        let text: string | null = null;

        try {
            const patch = git([...args, '--unified=0', base, head, '--', `:(top,literal)${path}`]);

            if (
                !patch.includes('\0') &&
                !/^Binary files |^GIT binary patch$|^[+-]Subproject commit |^(old mode|new mode)|^(new file mode|deleted file mode) 120000|^index .* 120000$/mu.test(
                    patch,
                )
            ) {
                let hunk = false;
                const lines: string[] = [];

                for (const line of patch.split('\n')) {
                    if (line.startsWith('@@ ')) hunk = true;
                    else if (hunk && (line.startsWith('+') || line.startsWith('-'))) lines.push(line.slice(1));
                }
                text = lines.join('\n');
            }
        } catch {
            // Limits, invalid UTF-8 and unreadable content must never become a negative text match.
        }

        diff.files.push({ path, text });
    }

    return { root, diff };
}
