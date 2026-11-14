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

/** One parser/heading contract for both generated PR bodies and Verify. */
export const TEST_STEPS_HEADING = 'Test steps';
export const TEST_STEPS_EXPECTED =
    'Expected a Markdown heading: ## Test steps (also accepts Test, Testing, Verify steps or Manual checks), followed by manual checks with observable results.';

export function verificationSection(body: string): { start: number; end: number } | null {
    const lines = body.split(/\r?\n/);
    let fence: string | undefined;
    let start = -1;
    let level = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];

        if (marker) {
            if (!fence) fence = marker;
            else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;

            continue;
        }

        if (fence) continue;

        const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);

        if (!heading) continue;

        if (start >= 0 && heading[1]!.length <= level) return { start, end: i };

        if (start < 0 && /^(Test steps|Test|Testing|Verify steps|Manual checks)$/i.test(heading[2]!)) {
            start = i;
            level = heading[1]!.length;
        }
    }

    return start < 0 ? null : { start, end: lines.length };
}

/** Preserve Markdown within the manual checks section. */
export function verificationTestSteps(body: string): string {
    const section = verificationSection(body);

    return section
        ? body
              .split(/\r?\n/)
              .slice(section.start + 1, section.end)
              .join('\n')
              .trim()
        : '';
}
