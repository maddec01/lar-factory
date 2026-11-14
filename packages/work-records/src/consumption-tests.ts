import { WorkRecordError } from './database.ts';

export interface ConsumptionTest {
    source: string;
    test: string;
    output: string;
    input: string;
}
export interface ConsumptionReview {
    source: string;
    input: string;
    test: string;
    evidence: string;
}

const filled = (value: unknown): value is string =>
    typeof value === 'string' && !!value.trim() && !/^(none|todo|tbd|n\/a|<.*>)\.?$/i.test(value.trim());

/** Structured evidence states the dataflow; Doubt/review still establish its truth. */
export function consumptionTests(brief: string): ConsumptionTest[] {
    const text = brief.replace(/^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm, '');
    const declarations = [...text.matchAll(/^\s*(?:-\s*)?Consumes:\s*(.+)$/gim)];
    const sources = declarations.flatMap((line) => [...line[1]!.matchAll(/`([^`]+)`/g)].map((ref) => ref[1]!));
    const error = () => {
        throw new WorkRecordError(
            'invalid',
            'Consumption test: supply one JSON line per Consumes source: {"source":"exact declared reference","test":"test/file.test.js: case feeds producer output into consumer","output":"producer output shape or producer golden fixture reference","input":"consumer public input accepting that output"}. A self-contained constant is insufficient.',
        );
    };

    if (declarations.some((line) => !/^none\.?$/i.test(line[1]!.trim()) && !/`[^`]+`/.test(line[1]!))) error();

    const tests = [...text.matchAll(/^\s*(?:-\s*)?Consumption test:\s*(.+)$/gim)].map((line) => {
        let value: ConsumptionTest;

        try {
            value = JSON.parse(line[1]!) as ConsumptionTest;
        } catch {
            return error();
        }

        if (
            !value ||
            !['source', 'test', 'output', 'input'].every((key) => filled(value[key as keyof ConsumptionTest])) ||
            !/[\w./-]+\.[a-z\w]+\s*:\s*\S.+/i.test(value.test)
        )
            error();

        if (!sources.includes(value.source)) error();

        return value;
    });

    if (sources.some((source) => !tests.some((test) => test.source === source))) error();

    return tests;
}

export function consumptionReview(brief: string, input: unknown, required: boolean): ConsumptionReview[] | undefined {
    if (input === undefined && !required) return undefined;

    const expected = consumptionTests(brief);

    if (!expected.length && input === undefined) return undefined;

    if (
        !Array.isArray(input) ||
        input.some((entry) => !entry || !['source', 'input', 'test', 'evidence'].every((key) => filled(entry[key])))
    )
        throw new WorkRecordError(
            'invalid',
            'Code review requires consumption: [{source,input,test,evidence}] confirming the public interface accepts producer output.',
        );

    if (
        required &&
        expected.some(
            (test) =>
                !input.some(
                    (entry) => entry.source === test.source && entry.input === test.input && entry.test === test.test,
                ),
        )
    )
        throw new WorkRecordError(
            'invalid',
            'Code review consumption checklist must cover every declared source, public input and named test.',
        );

    return input as ConsumptionReview[];
}
