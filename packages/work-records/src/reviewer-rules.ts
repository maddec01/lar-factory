import type { ReviewerTrigger } from '@lar-factory/shared/factory-settings';

export interface ReviewDiff {
    files: { path: string; text: string | null }[];
    /** False when the path list could not be read completely. Null text means unavailable/binary. */
    complete: boolean;
}
interface TriggerMatch {
    outcome: 'matched' | 'unmatched' | 'uncertain';
    rule: string;
    evidence: string;
}

type Policy = Extract<ReviewerTrigger, { kind: 'policy' }>['policy'];

// Version 1: fixed, case-insensitive policy signals. Text includes removed and added lines only.
const policies: Record<Policy, { path: RegExp; text: RegExp }> = {
    security: {
        path: /auth|session|permission|secret|credential|password|token|input|validat|upload|filesystem|[/._-]fs[/._-]|shell|\.sh$|\.bash$|\.zsh$|(^|\/)\.github\/|(^|\/)ci\/|docker|jenkins|package\.json$|lock(file)?([.-]|$)|requirements|cargo\.toml$|go\.mod$|network|http|api|webhook|socket/iu,
        text: /auth|session|permission|secret|credential|password|token|validat|saniti[sz]|req(uest)?\.(body|query|params|headers)|process\.env|readFile|writeFile|unlink|mkdir|path\.(join|resolve)|upload|exec(File|Sync)?\s*\(|spawn\s*\(|fetch\s*\(|https?:|socket|XMLHttpRequest|innerHTML/iu,
    },
    ui: {
        path: /(^|\/)(web|ui|views?|screens?|components?|pages?|styles?|assets?|public|locales?|i18n)(\/|\.)|\.(tsx|jsx|vue|svelte|html?|css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|storyboard|xib)$/iu,
        text: /<[A-Za-z][\w.-]*(\s|\/?>)|className|textContent|innerHTML|aria-|SwiftUI|\b(Text|Button|View|Composable|Widget)\s*\(/u,
    },
    performance: {
        path: /render|poll|quer(y|ies)|database|(^|\/)(db|cache|hot[-_]?paths?)(\/|\.)|bundle|webpack|vite\.config|rollup|\.(tsx|jsx|vue|svelte|html?|css|scss|sass|less)$|package\.json$|lock(file)?([.-]|$)/iu,
        text: /render|poll|setInterval|requestAnimationFrame|use(Memo|Callback|Effect)|\bSELECT\b|\bJOIN\b|\bquery\b|\b(for|while)\s*\(|\bfor\s+\w+\s+in\b|\.(map|flatMap|filter|reduce|sort|forEach)\s*\(/iu,
    },
};

const result = (outcome: TriggerMatch['outcome'], rule: string, evidence: string): TriggerMatch => ({
    outcome,
    rule,
    evidence,
});

/** Formats whose complete changed text version 1 can classify by its fixed path/symbol rules. */
function recognizedText(path: string): boolean {
    return /\.(md|txt|rst|adoc|[cm]?[jt]sx?|vue|svelte|html?|css|scss|sass|less|json|ya?ml|toml|xml|sql|prisma|graphql|gql|py|rb|go|rs|java|kt|kts|swift|dart|[cmh]|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|bat|cmd|lock)$/iu.test(
        path,
    );
}

function policyMatch(policy: Policy, diff: ReviewDiff): TriggerMatch {
    const signals = policies[policy];

    for (const file of diff.files) {
        if (signals.path.test(file.path)) return result('matched', `${policy}.path`, file.path);

        const index = file.text?.split('\n').findIndex((line) => signals.text.test(line)) ?? -1;

        if (index >= 0) return result('matched', `${policy}.text`, `${file.path}:changed-line-${index + 1}`);
    }

    if (!diff.complete) return result('uncertain', `${policy}.incomplete-paths`, 'Changed paths unavailable.');

    const opaque = diff.files.find((file) => file.text === null || !recognizedText(file.path));

    // Unsupported formats and missing content are uncertainty, not evidence that no rule matched.
    if (opaque) return result('uncertain', `${policy}.unclassified-impact`, opaque.path);

    return result('unmatched', `${policy}.no-signal`, 'Complete recognized-text diff without policy signals.');
}

/** Bounded dynamic programming, not caller-supplied regex. * and ? stay within one path segment. */
function segment(pattern: string, value: string): boolean {
    let row = [true, ...Array<boolean>(value.length).fill(false)];

    for (const char of pattern) {
        const next = Array<boolean>(value.length + 1).fill(false);

        next[0] = char === '*' && row[0]!;
        for (let i = 1; i <= value.length; i++)
            next[i] = char === '*' ? row[i]! || next[i - 1]! : row[i - 1]! && (char === '?' || char === value[i - 1]);
        row = next;
    }

    return row[value.length]!;
}

function glob(pattern: string, path: string): boolean | null {
    if (pattern.length > 512 || /[[\]{}()!\\]/u.test(pattern) || pattern.startsWith('/')) return null;

    const parts = pattern.split('/');
    const names = path.split('/');
    let row = [true, ...Array<boolean>(names.length).fill(false)];

    for (const part of parts) {
        if (part.includes('**') && part !== '**') return null;

        const next = Array<boolean>(names.length + 1).fill(false);

        next[0] = part === '**' && row[0]!;
        for (let i = 1; i <= names.length; i++)
            next[i] = part === '**' ? row[i]! || next[i - 1]! : row[i - 1]! && segment(part, names[i - 1]!);
        row = next;
    }

    return row[names.length]!;
}

export function matchReviewerTrigger(trigger: ReviewerTrigger, diff: ReviewDiff): TriggerMatch {
    if (trigger.kind === 'policy') return policyMatch(trigger.policy, diff);

    let uncertain: TriggerMatch | undefined;

    for (const [index, entry] of trigger.any.entries()) {
        const rule = `custom.any.${index + 1}.${entry.target}`;

        if (entry.target === 'path-glob' && glob(entry.pattern, '') === null)
            uncertain ??= result(
                'uncertain',
                rule,
                'Unsupported path glob; supported: literals, *, ?, and ** segments.',
            );

        for (const file of diff.files) {
            const matches =
                entry.target === 'path-glob'
                    ? glob(entry.pattern, file.path)
                    : file.text === null
                      ? null
                      : file.text.includes(entry.pattern);

            if (matches === true) return result('matched', rule, file.path);

            if (matches === null) uncertain ??= result('uncertain', rule, file.path);
        }

        if (!diff.complete) uncertain ??= result('uncertain', rule, 'Changed paths unavailable.');
    }

    return uncertain ?? result('unmatched', 'custom.no-match', 'No rule matched the complete diff.');
}
