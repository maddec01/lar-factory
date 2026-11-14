import { WorkRecordError } from './database.ts';

/** Presence is mechanical; Doubt still judges whether the claims are true and sufficient. */
export function requireCompleteBrief(kind: string, brief: string): void {
    if (['concept', 'decision', 'slice'].includes(kind)) return;

    const sections = new Map<string, string[]>();
    let heading = '';
    let fenced = false;

    for (const line of brief.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            continue;
        }

        if (fenced) continue;

        const title = /^#{2,3}\s+(.+?)\s*$/.exec(line);
        const label =
            /^(?:-\s*)?(Cause|Evidence|Affected files|Files|Regression test|Red-before-green|Tests):\s*(.*)$/i.exec(
                line.trim(),
            );

        if (title || label) {
            heading = (title?.[1] ?? label![1]!).toLowerCase();

            if (!sections.has(heading)) sections.set(heading, []);

            if (label?.[2]) sections.get(heading)!.push(label[2]);
        } else if (heading) sections.get(heading)!.push(line);
    }

    const content = (...names: string[]) =>
        names
            .flatMap((name) => sections.get(name) ?? [])
            .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
            .filter((line) => line && !/^(?:none|todo|tbd|n\/a|<.*>)\.?$/i.test(line))
            .join('\n');
    const missing: string[] = [];

    if (!content('done when', 'behaviour', 'acceptance', 'acceptance criteria'))
        missing.push('acceptance (Done when / Behaviour)');

    if (!content('files', 'affected files', 'affected areas')) missing.push('affected files (Scope / Files)');

    const named = (value: string) => /`[^`\n]+`/.test(value);

    if (kind === 'bug') {
        if (!content('cause')) missing.push('cause');

        if (!content('evidence')) missing.push('evidence');

        if (!named(content('regression test'))) missing.push('named regression test');

        if (!content('red-before-green')) missing.push('red-before-green');
    } else if (!named(content('tests'))) missing.push('named tests (Done when / Tests)');

    if (missing.length)
        throw new WorkRecordError(
            'invalid',
            `Incomplete ${kind} brief. Missing: ${missing.join('; ')}. Save the missing sections and rerun the gate; Doubt judges their substance.`,
        );
}
