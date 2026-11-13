import { createHash } from 'node:crypto';

import { WorkRecordError } from './database.ts';

/** Only stated constraints; empty lists and null size mean unspecified. */
export interface BriefScope {
    files: string[];
    tests: string[];
    behaviour: string[];
    excluded: string[];
    size: 'Small' | 'Larger' | null;
    verify: { required: boolean; visibleUi: string | null };
}
interface ScopeDifference {
    field: string;
    value: string;
}
export interface ScopeCheck {
    ok: boolean;
    briefDigest: string | null;
    missing: ScopeDifference[];
    extra: ScopeDifference[];
}

const invalid = (): never => {
    throw new WorkRecordError(
        'invalid',
        'Scope needs {files:[],tests:[],behaviour:[],excluded:[],size:"Small"|"Larger"|null,verify:{required:boolean,visibleUi:string|null}}; Verify is only for visible UI behaviour a person must check.',
    );
};
const object = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();

    const result = value as Record<string, unknown>;

    if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) invalid();

    return result;
};
const line = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 4000 || /[\r\n\0]/.test(value)) invalid();

    return (value as string).trim();
};

export function parseBriefScope(value: unknown): BriefScope {
    const input = object(value, ['files', 'tests', 'behaviour', 'excluded', 'size', 'verify']);
    const list = (key: string): string[] => {
        const entries = input[key];

        if (!Array.isArray(entries) || entries.length > 100) return invalid();

        const result = entries.map(line);

        if (new Set(result).size !== result.length) invalid();

        return result;
    };
    const verify = object(input.verify, ['required', 'visibleUi']);

    if (typeof verify.required !== 'boolean') invalid();

    const visibleUi = verify.visibleUi === null ? null : line(verify.visibleUi);

    if (verify.required !== (visibleUi !== null)) invalid();

    if (input.size !== null && input.size !== 'Small' && input.size !== 'Larger') invalid();

    const scope: BriefScope = {
        files: list('files'),
        tests: list('tests'),
        behaviour: list('behaviour'),
        excluded: list('excluded'),
        size: input.size as BriefScope['size'],
        verify: { required: verify.required as boolean, visibleUi },
    };

    if (!scope.behaviour.length) invalid();

    return scope;
}

/** These sections are the brief's authoritative scope, rendered from the confirmation once. */
export function scopeMarkdown(scope: BriefScope): string {
    const bullets = (values: string[]) => values.map((value) => `- ${value}`).join('\n');

    return `## Done when\n### Behaviour\n${bullets(scope.behaviour)}\n### Tests\n${bullets(scope.tests)}\n\n## Scope\n### Files\n${bullets(scope.files)}\n### Size\n${scope.size ?? ''}\n### Excluded\n${bullets(scope.excluded)}\n\n## Verify\n${scope.verify.required ? `yes: ${scope.verify.visibleUi}` : 'no'}\n`;
}

export function briefScopeClaims(text: string): Map<string, string[]> {
    const result = new Map<string, string[]>();
    let section = '';
    let field = '';
    let fenced = false;

    for (const raw of text.split('\n')) {
        const value = raw.trim();

        if (/^(```|~~~)/.test(value)) fenced = !fenced;

        const files = !fenced && /^(?:-\s*)?Files:\s*(.+)$/i.exec(value);

        if (files) {
            const declared = [...files[1]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);

            result.set('scope.files', [...(result.get('scope.files') ?? []), ...declared]);
            continue;
        }

        if (!fenced && value.startsWith('## ')) {
            section = value.slice(3).toLowerCase();
            field = section;
        } else if (['done when', 'scope', 'verify'].includes(section)) {
            if (!fenced && value.startsWith('### ')) {
                field = `${section}.${value.slice(4).toLowerCase()}`;
            } else if (value) {
                result.set(field, [...(result.get(field) ?? []), value.replace(/^[-*] /, '')]);
            }
        }
    }

    return result;
}

/** Compare claims, not keywords: a negated extra requirement is still a changed claim. */
export function checkBriefScope(scope: BriefScope, brief: string | null): ScopeCheck {
    const expected = briefScopeClaims(scopeMarkdown(scope));
    const actual = briefScopeClaims(brief ?? '');

    // No stated boundary is different from a confirmed empty delivery.
    for (const [field, open] of [
        ['scope.files', !scope.files.length],
        ['done when.tests', !scope.tests.length],
        ['scope.excluded', !scope.excluded.length],
        ['scope.size', scope.size === null],
    ] as const) {
        if (open) actual.delete(field);
    }

    const difference = (a: Map<string, string[]>, b: Map<string, string[]>): ScopeDifference[] =>
        [...a].flatMap(([field, values]) => {
            const remaining = [...(b.get(field) ?? [])];

            return values.flatMap((value) => {
                const index = remaining.indexOf(value);

                if (index < 0) return [{ field, value }];

                remaining.splice(index, 1);

                return [];
            });
        });
    const missing = difference(expected, actual);
    const extra = difference(actual, expected);

    return {
        ok: !missing.length && !extra.length,
        briefDigest: brief?.trim() ? createHash('sha256').update(JSON.stringify(brief)).digest('hex') : null,
        missing,
        extra,
    };
}
