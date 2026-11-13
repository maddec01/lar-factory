import type { Item } from './item-domain.ts';

export interface VerificationResult {
    id: string;
    pr: string;
    head: string;
    result: 'pass' | 'fail';
    by: string;
    at: string;
    note: string | null;
    testSteps: string;
}
export interface Verification {
    required: boolean;
    head: string | null;
    invalidated?: boolean;
    latest: VerificationResult | null;
    history?: VerificationResult[];
    resume: { threadId: string; commandId: string; messageId: string; error: string | null; sent: boolean } | null;
}

export function verificationPassed(verification: Verification | undefined, head: string | undefined): boolean {
    return (
        !!head &&
        !verification?.invalidated &&
        verification?.head === head &&
        verification.latest?.head === head &&
        verification.latest.result === 'pass'
    );
}

export function verificationProblem(item: Pick<Item, 'verification'>, head: string | undefined): string | undefined {
    if (item.verification?.required && !verificationPassed(item.verification, head))
        return 'Pass Verify for the current PR head before merging.';

    return undefined;
}

/** Read only the PR's Test steps section, preserving its Markdown. */
export function verificationTestSteps(body: string): string {
    const lines = body.split(/\r?\n/);
    const start = lines.findIndex((line) => /^#{1,6}\s+Test steps\s*$/i.test(line));

    if (start < 0) return '';

    const level = lines[start]!.match(/^#+/)![0].length;
    const end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}}\\s+`).test(line));

    return lines
        .slice(start + 1, end < 0 ? undefined : end)
        .join('\n')
        .trim();
}
