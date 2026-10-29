// PROTOTYPE #496, throwaway. Editor B: Lexical (as T3 Code's composer) formatting as you type and storing Markdown.
// "- " makes a bullet, "1. " a numbered list, "# " a heading, **bold** bold; pasted plain-text Markdown renders.

import { useCallback, useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { $insertNodes, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from 'lexical';
import type { EditorState, LexicalEditor } from 'lexical';
import { $generateNodesFromDOM } from '@lexical/html';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { RichText } from '@lar-factory/ui/rich-text';

const theme = {
  heading: { h1: 'text-lg font-semibold mt-3 mb-1', h2: 'text-base font-semibold mt-3 mb-1', h3: 'font-semibold mt-2 mb-1' },
  list: { ul: 'list-disc ps-6 my-1', ol: 'list-decimal ps-6 my-1', listitem: 'my-0.5', nested: { listitem: 'list-none' } },
  paragraph: 'my-1',
  quote: 'border-s-2 ps-3 text-base-700 my-1',
  code: 'block rounded-md bg-base-200 p-3 font-mono text-xs my-1 whitespace-pre-wrap',
  link: 'text-(--lar-info-text) underline',
  text: { bold: 'font-semibold', italic: 'italic', strikethrough: 'line-through', code: 'rounded bg-base-200 px-1 font-mono text-xs' },
};

const LOOKS_LIKE_MARKDOWN = /(^|\n)\s*([-*+] |\d+[.)] |#{1,6} |> |```)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/;

/** Plain-text Markdown pasted without HTML goes in as formatted nodes, via the board's own Markdown renderer. */
function MarkdownPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(PASTE_COMMAND, (event) => {
    if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
    if (event.clipboardData.types.includes('text/html')) return false;
    const text = event.clipboardData.getData('text/plain');
    if (!LOOKS_LIKE_MARKDOWN.test(text)) return false;
    event.preventDefault();
    const html = renderToStaticMarkup(<RichText text={text} format="markdown" />);
    const dom = new DOMParser().parseFromString(html, 'text/html');
    const root = dom.querySelector('[data-slot="rich-text"]');
    if (root) dom.body.innerHTML = root.innerHTML;
    editor.update(() => $insertNodes($generateNodesFromDOM(editor, dom)));
    return true;
  }, COMMAND_PRIORITY_HIGH), [editor]);
  return null;
}

export function LiveEditor({ value, onChange, fill = false, label }: { value: string; onChange: (value: string) => void; fill?: boolean; label: string }) {
  const onEdit = useCallback((state: EditorState, _editor: LexicalEditor) => state.read(() => onChange($convertToMarkdownString(TRANSFORMERS))), [onChange]);
  return (
    <div className={`grid min-h-0 ${fill ? 'flex-1 grid-rows-[minmax(0,1fr)_auto]' : ''}`}>
      <LexicalComposer initialConfig={{
        namespace: 'prototype-496', theme, onError: (error) => { throw error; },
        nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode],
        editorState: () => $convertFromMarkdownString(value, TRANSFORMERS),
      }}>
        <div className="relative min-h-0">
          <RichTextPlugin
            contentEditable={<ContentEditable aria-label={label}
              className={`overflow-y-auto rounded-md border border-base-300 bg-base-100 px-3 py-2 text-sm leading-relaxed outline-none focus:border-(--ring) focus:ring-2 focus:ring-(--ring)/30 ${fill ? 'h-full min-h-40' : 'min-h-40 max-h-80'}`} />}
            placeholder={<div className="pointer-events-none absolute left-3 top-2 text-sm text-(--muted-foreground)">Type - for a list, 1. for steps, # for a heading</div>}
            ErrorBoundary={LexicalErrorBoundary} />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <TabIndentationPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <MarkdownPastePlugin />
        <OnChangePlugin ignoreSelectionChange onChange={onEdit} />
      </LexicalComposer>
      <p className="m-0 pt-1 text-xs text-(--muted-foreground)">Formats as you type; saved as Markdown.</p>
    </div>
  );
}
