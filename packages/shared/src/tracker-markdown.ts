// Azure's text fields take HTML. Escape authored HTML and allow only safe link protocols.
import { Marked } from 'marked';
import { readTrackerStructure } from './tracker-structure.ts';

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const safeUrl = (href: string) => /^(?:https?:|mailto:)/i.test(href);
const markdown = new Marked({ renderer: {
  html({ text }) {
    const marker = /<!-- lar-factory:(?:spec|original|end) -->|<!-- lar-factory:create \{"identity":"[a-zA-Z0-9-]+"\} -->|<!-- lar-factory:structure\n\{[^<>\n]*\}\n-->|<details>|<summary>Original<\/summary>|<\/details>/g;
    const parts: string[] = [];
    let end = 0;
    for (const match of text.matchAll(marker)) {
      parts.push(escape(text.slice(end, match.index)), match[0]);
      end = match.index + match[0].length;
    }
    return parts.join('') + escape(text.slice(end));
  },
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    return safeUrl(href) ? `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''}>${text}</a>` : text;
  },
  image({ href, text }) { return safeUrl(href) ? `<img src="${escape(href)}" alt="${escape(text)}">` : escape(text); },
} });

export function trackerMarkdownHtml(text: string): string {
  // Normalize valid JSON before Markdown splits HTML at any embedded comment terminator.
  const safe = text.replace(/<!-- lar-factory:structure\n\{[^\n]*\}\n-->/g, block => {
    try {
      const payload = JSON.stringify(readTrackerStructure(block)).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
      return `<!-- lar-factory:structure\n${payload}\n-->`;
    } catch { return block; }
  });
  return markdown.parse(safe, { async: false });
}
