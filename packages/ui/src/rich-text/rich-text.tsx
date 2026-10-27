// Renders a GitHub or Azure DevOps description or comment the way the provider shows it. Markdown is
// GitHub-flavoured and may hold raw HTML; an Azure DevOps field may be HTML. Both go through the same
// sanitizer, then images become links (the board server never proxies an image and the page never loads one)
// and links open in a new tab. The output never makes its container scroll sideways.
import type { Element, ElementContent, Root } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import Markdown from 'react-markdown';
import rehypeParse from 'rehype-parse';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { unified } from 'unified';
import type { PluggableList } from 'unified';

export type RichTextFormat = 'markdown' | 'html';

const link = (properties: Element['properties'], children: ElementContent[]): Element => ({
  type: 'element',
  tagName: 'a',
  properties: { ...properties, target: '_blank', rel: ['noopener', 'noreferrer'] },
  children,
});

/** Turns every image into a link to it and gives every link a new tab. An image inside a link, or without a
 *  usable source, becomes its text, since a link cannot hold a link. */
function rehypeImagesAsLinks() {
  const walk = (node: Root | Element, inLink: boolean): void => {
    node.children = node.children.map((child) => {
      if (child.type !== 'element') return child;
      if (child.tagName === 'img') {
        const src = typeof child.properties.src === 'string' ? child.properties.src : '';
        const text: ElementContent = { type: 'text', value: String(child.properties.alt || src) };
        return src && !inLink ? link({ href: src }, [text]) : text;
      }
      walk(child, inLink || child.tagName === 'a');
      return child.tagName === 'a' ? link(child.properties, child.children) : child;
    });
  };
  return (tree: Root) => walk(tree, false);
}

// The default schema is GitHub's: it keeps <details>, tables and task-list checkboxes and drops scripts,
// handlers, javascript: URLs, iframes and styles. It keeps a dropped <style>'s text, so strip that element whole.
const schema = { ...defaultSchema, strip: [...(defaultSchema.strip ?? []), 'style'] };
const rehypePlugins: PluggableList = [rehypeRaw, [rehypeSanitize, schema], rehypeImagesAsLinks];
const htmlProcessor = unified().use(rehypeParse, { fragment: true }).use(rehypeSanitize, schema).use(rehypeImagesAsLinks);

// Tailwind has no typography plugin and its preflight resets headings, lists and tables, so the elements a
// provider's text holds are styled here. Every class sits in this file, which styles.css lists as a @source.
const body = [
  'min-w-0 max-w-full text-sm leading-relaxed break-words [overflow-wrap:anywhere]',
  '[&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_blockquote]:my-2',
  '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold',
  '[&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6 [&_li]:my-0.5 [&_.task-list-item]:list-none [&_.task-list-item]:ms-[-1.5rem] [&_input]:me-1.5',
  '[&_a]:text-(--lar-info-text) [&_a]:underline [&_a]:underline-offset-2',
  '[&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_blockquote]:text-base-700',
  '[&_hr]:my-4',
  '[&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:rounded-md [&_pre]:bg-base-200 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs',
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-base-200 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-xs',
  '[&_table]:my-2 [&_table]:w-full [&_table]:max-w-full [&_table]:table-fixed [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-start [&_td]:border [&_td]:px-2 [&_td]:py-1',
  '[&_details]:my-2 [&_summary]:cursor-pointer [&_summary]:font-medium',
].join(' ');

export function RichText({ text, format, className }: { text: string; format: RichTextFormat; className?: string }) {
  if (text === '') return null;
  return (
    <div className={`${body} ${className ?? ''}`} data-slot="rich-text">
      {format === 'markdown' ? (
        <Markdown rehypePlugins={rehypePlugins} remarkPlugins={[remarkGfm]}>
          {text}
        </Markdown>
      ) : (
        toJsxRuntime(htmlProcessor.runSync(htmlProcessor.parse(text)), { Fragment, jsx, jsxs })
      )}
    </div>
  );
}
