// Azure's text fields take HTML. Escape authored HTML and allow only safe link protocols.
import { Marked } from 'marked';

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const safeUrl = (href: string) => /^(?:https?:|mailto:)/i.test(href);
const markdown = new Marked({ renderer: {
  html({ text }) { return /^<!-- lar-factory:(?:create|structure)\b(?:(?!-->)[\s\S])*-->\s*$/.test(text) ? text : escape(text); },
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    return safeUrl(href) ? `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''}>${text}</a>` : text;
  },
  image({ href, text }) { return safeUrl(href) ? `<img src="${escape(href)}" alt="${escape(text)}">` : escape(text); },
} });

export function trackerMarkdownHtml(text: string): string {
  return markdown.parse(text, { async: false });
}
