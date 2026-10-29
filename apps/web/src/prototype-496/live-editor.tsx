// PROTOTYPE #496, throwaway. The description editor: Lexical (as T3 Code's composer) formatting as you type and storing
// Markdown, on a writing surface with a light toolbar. "- " makes a bullet, "1. " a numbered list, "# " a heading,
// **bold** bold; pasted plain-text Markdown renders.

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Bold, Heading, Italic, Link, List, ListOrdered } from 'lucide-react';
import { $createParagraphNode, $getSelection, $insertNodes, $isRangeSelection, COMMAND_PRIORITY_HIGH, FORMAT_TEXT_COMMAND, PASTE_COMMAND } from 'lexical';
import type { EditorState, LexicalEditor } from 'lexical';
import { $generateNodesFromDOM } from '@lexical/html';
import { CodeNode } from '@lexical/code';
import { $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $isListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode, REMOVE_LIST_COMMAND } from '@lexical/list';
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import { $createHeadingNode, $isHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
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
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/design-system/Tooltip';
import { RichText } from '@lar-factory/ui/rich-text';

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
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

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

type Active = { bold: boolean; italic: boolean; link: boolean; block: 'paragraph' | 'heading' | 'bullet' | 'number' };
const NONE: Active = { bold: false, italic: false, link: false, block: 'paragraph' };

function readActive(state: EditorState): Active {
  return state.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return NONE;
    const node = selection.anchor.getNode();
    const top = node.getKey() === 'root' ? null : node.getTopLevelElement();
    const block = $isHeadingNode(top) ? 'heading' : $isListNode(top) ? (top.getListType() === 'number' ? 'number' : 'bullet') : 'paragraph';
    return { bold: selection.hasFormat('bold'), italic: selection.hasFormat('italic'), link: $isLinkNode(node.getParent()) || $isLinkNode(node), block };
  });
}

function ToolButton({ label, keys, on, icon, run }: { label: string; keys?: string; on: boolean; icon: ReactNode; run: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run}
          className={`grid size-7 place-items-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary [&_svg]:size-4 ${on ? 'bg-primary/10 text-primary' : 'text-base-700 hover:bg-base-200 hover:text-base-content'}`}>
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}{keys && <span className="ms-2 text-base-500">{keys}</span>}</TooltipPopup>
    </Tooltip>
  );
}

function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState(NONE);
  useEffect(() => editor.registerUpdateListener(({ editorState }) => setActive(readActive(editorState))), [editor]);
  const block = (type: 'heading' | 'bullet' | 'number') => {
    if (type === 'heading') editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, () => (active.block === 'heading' ? $createParagraphNode() : $createHeadingNode('h2')));
    });
    else if (active.block === type) editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    else editor.dispatchCommand(type === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined);
  };
  const link = () => {
    if (active.link) return editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    const url = prompt('Link to');
    if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
  };
  return (
    <div role="toolbar" aria-label="Formatting" className="flex shrink-0 items-center gap-0.5 border-b border-base-300/70 px-2 py-1">
      <ToolButton label="Bold" keys={`${MOD}B`} on={active.bold} icon={<Bold />} run={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} />
      <ToolButton label="Italic" keys={`${MOD}I`} on={active.italic} icon={<Italic />} run={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} />
      <span className="mx-1 h-4 w-px bg-base-300" />
      <ToolButton label="Heading" keys="#" on={active.block === 'heading'} icon={<Heading />} run={() => block('heading')} />
      <ToolButton label="Bulleted list" keys="-" on={active.block === 'bullet'} icon={<List />} run={() => block('bullet')} />
      <ToolButton label="Numbered list" keys="1." on={active.block === 'number'} icon={<ListOrdered />} run={() => block('number')} />
      <ToolButton label="Link" on={active.link} icon={<Link />} run={link} />
      <span className="ms-auto pe-1 text-[11px] text-base-500">Markdown</span>
    </div>
  );
}

/** Reports the starting text as the editor writes it back, so a caller can tell an edit from Markdown's round trip. */
function BaselinePlugin({ onBaseline }: { onBaseline: (value: string) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.getEditorState().read(() => onBaseline($convertToMarkdownString(TRANSFORMERS))), [editor, onBaseline]);
  return null;
}

/** `fill` grows the editor into its parent's height; otherwise it grows with its text up to a cap. */
export function LiveEditor({ value, onChange, fill = false, autoFocus = false, onBaseline, label, placeholder }: { value: string; onChange: (value: string) => void; fill?: boolean; autoFocus?: boolean; onBaseline?: (value: string) => void; label: string; placeholder: string }) {
  const onEdit = useCallback((state: EditorState, _editor: LexicalEditor) => state.read(() => onChange($convertToMarkdownString(TRANSFORMERS))), [onChange]);
  return (
    <LexicalComposer initialConfig={{
      namespace: 'prototype-496', theme, onError: (error) => { throw error; },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode],
      editorState: () => $convertFromMarkdownString(value, TRANSFORMERS),
    }}>
      <div className={`flex flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-primary/15 ${fill ? 'min-h-0 flex-1' : ''}`}>
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
