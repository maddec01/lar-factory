import type { DependencyHold } from './item-domain.ts';

export type DependencyStatus = Pick<DependencyHold, 'owner' | 'need' | 'evidence' | 'met' | 'needsReview'>;
export const DEPENDENCY_STATUS_NOTICE =
    'Dependency and proof status in the retained brief is superseded by these current Dependency records. Approved brief bytes are unchanged.';
export const dependencyStatusText = (d: DependencyStatus): string =>
    `${d.owner}: ${d.need} — ${d.met ? `Met by ${d.met.by} at ${d.met.at}` : 'Unmet'}${d.needsReview ? '; observations need review' : ''}. Evidence: ${d.evidence || 'None recorded'}`;

/** Narrow compatibility/authoring rule for the factual prose observed in S05, outside product examples. */
export function hasDependencyStatusProse(markdown: string): boolean {
    let fence = '';

    return markdown.split(/\r?\n/).some((line) => {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];

        if (marker && (!fence || marker[0] === fence[0])) fence = fence ? '' : marker;

        return (
            !fence &&
            !marker &&
            /(?:^|[.!?]\s+|[-*]\s+)(?:No proof has been supplied\.|The external Dependency remains unmet until actual proof is attached, inspected and accepted\.)/.test(
                line.trim(),
            )
        );
    });
}

const escape = (text: string) =>
    text.replace(
        /[&<>"']/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );

export const withoutDependencyStatus = (body: string): string =>
    body.replace(/^<p><strong>Current dependency status \(Lar Factory\)<\/strong>:[\s\S]*?<\/p>\n/, '');

/** Presentation sits outside Spec delimiters and never participates in product approval. */
export function markDependencyStatus(body: string, dependencies: readonly DependencyStatus[]): string {
    const clean = withoutDependencyStatus(body);

    return dependencies.length
        ? `<p><strong>Current dependency status (Lar Factory)</strong>: ${escape(DEPENDENCY_STATUS_NOTICE)}<br>${dependencies.map((d) => escape(dependencyStatusText(d))).join('<br>')}</p>\n${clean}`
        : clean;
}
