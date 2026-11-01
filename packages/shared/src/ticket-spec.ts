import { trackerMarkdownHtml } from './tracker-markdown.ts';

// Ticket text shared by local conversion and subsequent Spec writes.
export function formatTicketSpec(spec: string, original: string, options?: { format: 'html'; originalFormat?: 'html' | 'markdown' }): string {
  if (options?.format === 'html') {
    const authored = options.originalFormat === 'html' ? original : trackerMarkdownHtml(original);
    return `<!-- lar-factory:spec -->\n${trackerMarkdownHtml(spec)}\n<!-- lar-factory:original -->\n<details>\n<summary>Original</summary>\n<h2>Original (Lar Factory)</h2>\n${authored}\n</details>\n<!-- lar-factory:end -->`;
  }
  return `<!-- lar-factory:spec -->\n${spec}\n\n<!-- lar-factory:original -->\n<details>\n<summary>Original</summary>\n\n${original}\n\n</details>\n<!-- lar-factory:end -->`;
}

/** Markerless descriptions are whole Specs. Metadata is kept separately by the writer. */
export function readTicketSpec(body: string): { marked: boolean; spec: string; original: string | null } {
  const match = /^<!-- lar-factory:spec -->\n([\s\S]*)\n\n<!-- lar-factory:original -->\n<details>\n<summary>Original<\/summary>\n\n([\s\S]*)\n\n<\/details>\n<!-- lar-factory:end -->\s*$/.exec(body);
  if (match) return { marked: true, spec: match[1]!, original: match[2]! };
  const htmlDetails = /^<!-- lar-factory:spec -->\s*([\s\S]*?)\s*<!-- lar-factory:original -->\s*<details>\s*<summary>Original<\/summary>\s*([\s\S]*?)\s*<\/details>\s*<!-- lar-factory:end -->\s*$/.exec(body);
  if (htmlDetails) return { marked: true, spec: htmlDetails[1]!, original: htmlDetails[2]!.replace(/^<h2>Original \(Lar Factory\)<\/h2>\s*/i, '') };
  // Azure may strip comments and details. The visible heading is deliberately reserved for this fallback.
  const heading = /(?:<!-- lar-factory:original -->\s*)?<h2>Original \(Lar Factory\)<\/h2>\s*/i.exec(body);
  if (heading) {
    const spec = body.slice(0, heading.index).replace(/^\s*<!-- lar-factory:spec -->\s*/, '')
      .replace(/(?:<!-- lar-factory:original -->\s*)?<details>\s*<summary>Original<\/summary>\s*$/i, '').trimEnd();
    const original = body.slice(heading.index + heading[0].length).replace(/\s*(?:<\/details>\s*)?(?:<!-- lar-factory:end -->\s*)?$/, '');
    return { marked: true, spec, original };
  }
  return { marked: false, spec: body, original: null };
}
