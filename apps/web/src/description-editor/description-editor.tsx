// The description editor: Lexical, formatting as you type and storing Markdown, under a light toolbar. "- " starts a
// bullet list, "1. " a numbered list, "# " a heading and **bold** turns bold; pasted plain-text Markdown renders.

import { useCallback, useEffect } from 'react';
import { $insertNodes, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from 'lexical';
import type { EditorState } from 'lexical';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { $convertFromMarkdownString, $convertToMarkdownString, $generateNodesFromMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { Toolbar } from './toolbar.tsx';

const theme = {
  heading: { h1: 'text-xl font-semibold mt-4 mb-1.5 first:mt-0', h2: 'text-lg font-semibold mt-4 mb-1 first:mt-0', h3: 'font-semibold mt-3 mb-1 first:mt-0' },
  list: { ul: 'list-disc ps-6 my-1.5', ol: 'list-decimal ps-6 my-1.5', listitem: 'my-0.5 marker:text-base-500', nested: { listitem: 'list-none' } },
  paragraph: 'my-1.5 first:mt-0',
  quote: 'border-s-2 border-base-300 ps-3 text-base-700 my-1.5',
  code: 'block rounded-md bg-base-200 p-3 font-mono text-xs my-1.5 whitespace-pre-wrap',
  link: 'text-(--lar-info-text) underline underline-offset-2',
  text: { bold: 'font-semibold', italic: 'italic', strikethrough: 'line-through', code: 'rounded bg-base-200 px-1 font-mono text-[0.85em]' },
};

const LOOKS_LIKE_MARKDOWN = /(^|\n)\s*([-*+] |\d+[.)] |#{1,6} |> |```)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/;

/** Plain text that reads as Markdown, pasted without HTML, goes in as the nodes it stands for. */
function MarkdownPastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(PASTE_COMMAND, (event) => {
    const data = 'clipboardData' in event ? event.clipboardData : null;
    if (!data || data.types.includes('text/html')) return false;
    const text = data.getData('text/plain');
    if (!LOOKS_LIKE_MARKDOWN.test(text)) return false;
    event.preventDefault();
    editor.update(() => $insertNodes($generateNodesFromMarkdownString(text, TRANSFORMERS)));
    return true;
  }, COMMAND_PRIORITY_HIGH), [editor]);
  return null;
}

/** Reports the starting text as the editor writes it back, so a caller can tell an edit from Markdown's round trip. */
function BaselinePlugin({ onBaseline }: { onBaseline: (markdown: string) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.getEditorState().read(() => onBaseline($convertToMarkdownString(TRANSFORMERS))), [editor, onBaseline]);
  return null;
}

interface DescriptionEditorProps {
  /** The Markdown it starts from; later changes to it are ignored. */
  value: string;
  onChange: (markdown: string) => void;
  label: string;
  placeholder: string;
  /** Grows the editor into its parent's height; otherwise it grows with its text up to a cap. */
  fill?: boolean;
  autoFocus?: boolean;
  onBaseline?: (markdown: string) => void;
}

export function DescriptionEditor({ value, onChange, label, placeholder, fill = false, autoFocus = false, onBaseline }: DescriptionEditorProps) {
  const onEdit = useCallback((state: EditorState) => state.read(() => onChange($convertToMarkdownString(TRANSFORMERS))), [onChange]);
  return (
    <LexicalComposer initialConfig={{
      namespace: 'description', theme, onError: (error) => { throw error; },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode],
      editorState: () => $convertFromMarkdownString(value, TRANSFORMERS),
    }}>
      <div data-description-editor className={`flex flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-primary/15 ${fill ? 'min-h-0 flex-1' : ''}`}>
        <Toolbar />
        <div className={`relative overflow-y-auto ${fill ? 'min-h-0 flex-1' : 'max-h-[min(24rem,45dvh)]'}`}>
          <RichTextPlugin
            contentEditable={<ContentEditable aria-label={label}
              className={`px-4 py-3 text-[15px] leading-relaxed outline-none ${fill ? 'min-h-full' : 'min-h-44'}`} />}
            placeholder={<div className="pointer-events-none absolute left-4 top-3 text-[15px] leading-relaxed text-base-500">{placeholder}</div>}
            ErrorBoundary={LexicalErrorBoundary} />
        </div>
      </div>
      {autoFocus && <AutoFocusPlugin defaultSelection="rootEnd" />}
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <TabIndentationPlugin />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <MarkdownPastePlugin />
      {onBaseline && <BaselinePlugin onBaseline={onBaseline} />}
      <OnChangePlugin ignoreSelectionChange onChange={onEdit} />
    </LexicalComposer>
  );
}
