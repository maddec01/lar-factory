import { TEST_STEPS_HEADING, verificationSection, verificationTestSteps } from '@lar-factory/shared';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/** Generate the exact manual-check section the board reads, retaining the rest of the PR template. */
function publicationBody(body: string, steps?: string): string {
    const checks = steps?.trim() ?? verificationTestSteps(body);
    let section = verificationSection(body);

    while (section) {
        const lines = body.split(/\r?\n/);

        body = [lines.slice(0, section.start).join('\n').trimEnd(), lines.slice(section.end).join('\n').trimStart()]
            .filter(Boolean)
            .join('\n\n');
        section = verificationSection(body);
    }

    return `${body.trimEnd()}${checks ? `\n\n## ${TEST_STEPS_HEADING}\n${checks}` : ''}\n`;
}

export function publicationBodyCommand(args: string[]): number {
    try {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: { file: { type: 'string' }, to: { type: 'string' }, 'test-steps': { type: 'string' } },
        });

        if (positionals.length || !values.file || !values.to)
            throw Error('Use pr-body --file BODY --to OUTPUT [--test-steps STEPS].');

        const body = publicationBody(
            readFileSync(values.file, 'utf8'),
            values['test-steps'] ? readFileSync(values['test-steps'], 'utf8') : undefined,
        );

        writeFileSync(values.to, body);

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    }
}
