import { withoutDependencyStatus } from './dependency-status.ts';
import { trackerMarkdownHtml } from './tracker-markdown.ts';

/** Visible on both trackers, outside the retained approved Spec. */
export const OUT_OF_DATE_SPEC =
    '<p><strong>Out-of-date Spec</strong>: changes await brief approval on the board.</p>\n';
export const withoutSpecFreshness = (body: string): string => {
    const clean = withoutDependencyStatus(body);

    return withoutDependencyStatus(clean.startsWith(OUT_OF_DATE_SPEC) ? clean.slice(OUT_OF_DATE_SPEC.length) : clean);
};
export const markSpecFreshness = (body: string, stale: boolean): string =>
    (stale ? OUT_OF_DATE_SPEC : '') + withoutSpecFreshness(body);

/** Creation metadata is temporary and never part of an authored request. */
export const withoutTicketCreationMarker = (body: string): string =>
    body.replace(/<!-- lar-factory:create [^\n]*? -->/g, '');

const declaration =
    /^\s*(?:-\s*)?(Blocked by|Consumes|Produces|Contracts|Parent contract|No ordering needed|Consumption test):/i;

/** Local graph and test declarations stay in the brief, outside the team's Spec prose. */
function splitBrief(brief: string): { prose: string; declarations: string[] } {
    const declarations: string[] = [];
    let fence: string | undefined;
    const prose = brief
        .split('\n')
        .filter((line) => {
            const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];

            if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length)))
                fence = fence ? undefined : marker;

            if (fence || !declaration.test(line)) return true;

            declarations.push(line);

            return false;
        })
        .join('\n');

    return { prose, declarations };
}

export function briefProse(brief: string): string {
    let size = false;
    let fence = '';
    const prose = splitBrief(brief)
        .prose.split('\n')
        .filter((line) => {
            const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];

            if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length)))
                fence = fence ? '' : marker;

            if (!fence && !marker && /^#{1,3}\s/.test(line)) size = /^### Size[ \t]*$/.test(line);

            return !size;
        })
        .join('\n');

    return prose
        .replace(/^## Tests[ \t]*$/gm, '### Tests')
        .replace(/^## (?:Scope|Notes for the builder)[ \t]*(?:\n[ \t]*)*(?=^## |(?![\s\S]))/gm, '');
}

/** A tracker prose edit cannot remove the local declarations used by gates and graph readers. */
export function retainBriefDeclarations(brief: string, local: string): string {
    const size = /^### Size[ \t]*\n(?:Small|Larger)[ \t]*(?=\n|$)/m.exec(local)?.[0];

    if (size && !/^### Size[ \t]*$/m.test(brief)) {
        const scope = /^## Scope[ \t]*$/m;

        brief = scope.test(brief)
            ? brief.replace(scope, (heading) => `${heading}\n${size}\n`)
            : `${brief.trimEnd()}\n\n## Scope\n${size}`;
    }

    const incoming = splitBrief(brief).declarations;
    const retained = splitBrief(local).declarations.filter(
        (line) =>
            !incoming.some(
                (other) => declaration.exec(other)![1]!.toLowerCase() === declaration.exec(line)![1]!.toLowerCase(),
            ),
    );

    if (!retained.length) return brief;

    const notes = /^## Notes for the builder[ \t]*$/m;

    return notes.test(brief)
        ? brief.replace(notes, (heading) => `${heading}\n${retained.join('\n')}\n`)
        : `${brief.trimEnd()}\n\n## Notes for the builder\n${retained.join('\n')}`;
}

// Ticket text shared by local conversion and subsequent Spec writes.
export function formatTicketSpec(
    spec: string,
    original: string,
    options?: { format: 'html'; originalFormat?: 'html' | 'markdown' },
): string {
    spec = briefProse(spec);
    original = withoutTicketCreationMarker(original);

    if (!original.trim())
        return `<!-- lar-factory:spec -->\n${options?.format === 'html' ? trackerMarkdownHtml(spec) : spec}\n\n<!-- lar-factory:original -->\n<!-- lar-factory:end -->`;

    if (options?.format === 'html') {
        const authored = options.originalFormat === 'html' ? original : trackerMarkdownHtml(original);

        return `<!-- lar-factory:spec -->\n${trackerMarkdownHtml(spec)}\n<!-- lar-factory:original -->\n<details>\n<summary>Original</summary>\n<h2>Original (Lar Factory)</h2>\n${authored}\n</details>\n<!-- lar-factory:end -->`;
    }

    return `<!-- lar-factory:spec -->\n${spec}\n\n<!-- lar-factory:original -->\n<details>\n<summary>Original</summary>\n\n${original}\n\n</details>\n<!-- lar-factory:end -->`;
}

/** Markerless descriptions are whole Specs. Metadata is kept separately by the writer. */
export function readTicketSpec(body: string): { marked: boolean; spec: string; original: string | null } {
    body = withoutSpecFreshness(body);

    const emptyOriginal =
        /^<!-- lar-factory:spec -->\n([\s\S]*)\n\n<!-- lar-factory:original -->\n<!-- lar-factory:end -->\s*$/.exec(
            body,
        );

    if (emptyOriginal) return { marked: true, spec: emptyOriginal[1]!, original: '' };

    const match =
        /^<!-- lar-factory:spec -->\n([\s\S]*)\n\n<!-- lar-factory:original -->\n<details>\n<summary>Original<\/summary>\n\n([\s\S]*)\n\n<\/details>\n<!-- lar-factory:end -->\s*$/.exec(
            body,
        );

    if (match) return { marked: true, spec: match[1]!, original: match[2]! };

    const htmlDetails =
        /^<!-- lar-factory:spec -->\s*([\s\S]*?)\s*<!-- lar-factory:original -->\s*<details>\s*<summary>Original<\/summary>\s*([\s\S]*?)\s*<\/details>\s*<!-- lar-factory:end -->\s*$/.exec(
            body,
        );

    if (htmlDetails)
        return {
            marked: true,
            spec: htmlDetails[1]!,
            original: htmlDetails[2]!.replace(/^<h2>Original \(Lar Factory\)<\/h2>\s*/i, ''),
        };

    // Azure may strip comments and details. The visible heading is deliberately reserved for this fallback.
    const heading = /(?:<!-- lar-factory:original -->\s*)?<h2>Original \(Lar Factory\)<\/h2>\s*/i.exec(body);

    if (heading) {
        const spec = body
            .slice(0, heading.index)
            .replace(/^\s*<!-- lar-factory:spec -->\s*/, '')
            .replace(/(?:<!-- lar-factory:original -->\s*)?<details>\s*<summary>Original<\/summary>\s*$/i, '')
            .trimEnd();
        const original = body
            .slice(heading.index + heading[0].length)
            .replace(/\s*(?:<\/details>\s*)?(?:<!-- lar-factory:end -->\s*)?$/, '');

        return { marked: true, spec, original };
    }

    return { marked: false, spec: body, original: null };
}
