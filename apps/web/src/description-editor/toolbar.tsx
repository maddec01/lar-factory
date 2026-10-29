// The description editor's toolbar: bold, italic, heading, bulleted list, numbered list and link, each pressed while
// the selection has it. Link opens a URL field under the toolbar, as Electron has no window.prompt: Enter links the
// selection, Escape or an empty URL closes it with no link, and Escape leaves the dialog open.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Bold, Heading, Italic, Link, List, ListOrdered } from 'lucide-react';
import { $createParagraphNode, $getSelection, $isRangeSelection, $setSelection, FORMAT_TEXT_COMMAND } from 'lexical';
import type { BaseSelection, EditorState } from 'lexical';
import { $isLinkNode, $toggleLink, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $isListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from '@lexical/list';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Popover } from '@lar-factory/ui/design-system/Popover';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/design-system/Tooltip';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

type Block = 'paragraph' | 'heading' | 'bullet' | 'number';
interface Active { bold: boolean; italic: boolean; link: boolean; block: Block }
const NONE: Active = { bold: false, italic: false, link: false, block: 'paragraph' };

/** What the selection has on. */
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
        {/* Pressing keeps the editor's selection: focus stays in the editor. */}
        <button type="button" aria-label={label} aria-pressed={on} onMouseDown={(event) => event.preventDefault()} onClick={run}
          className={`grid size-7 place-items-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary [&_svg]:size-4 ${on ? 'bg-primary/10 text-primary' : 'text-base-700 hover:bg-base-200 hover:text-base-content'}`}>
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}{keys && <span className="ms-2 text-base-500">{keys}</span>}</TooltipPopup>
    </Tooltip>
  );
}

/** The URL field Link opens, anchored under its button; `close` gets the URL to link, or null for none. A popover is a
 *  layer above the dialog, so Escape closes the field alone. */
function LinkField({ open, close, children }: { open: boolean; close: (url: string | null) => void; children: ReactNode }) {
  return (
    <Popover open={open} onOpenChange={(opened) => !opened && close(null)}>
      {/* The button opens the field itself, so the anchor's own toggle is turned off. */}
      <Popover.Trigger asChild onClick={(event) => event.preventDefault()}><span className="inline-flex">{children}</span></Popover.Trigger>
      {/* Portalled, its events still reach the form in the React tree, which would count them as edits. */}
      <Popover.Content side="bottom" align="start" onCloseAutoFocus={(event) => event.preventDefault()}
        onInput={(event) => event.stopPropagation()} onChange={(event) => event.stopPropagation()}>
        <input type="url" aria-label="Link URL" placeholder="https://…" autoComplete="off"
          className="h-8 w-64 max-w-full rounded-md border border-base-300 bg-base-100 px-2 text-sm outline-none focus:border-primary/60 focus:ring-3 focus:ring-primary/15"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            close(event.currentTarget.value.trim() || null);
          }} />
      </Popover.Content>
    </Popover>
  );
}

export function Toolbar() {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState(NONE);
  // The selection Link opened its field on, which the field's focus would otherwise lose.
  const [linking, setLinking] = useState<BaseSelection | null>(null);
  useEffect(() => editor.registerUpdateListener(({ editorState }) => setActive(readActive(editorState))), [editor]);
  const heading = () => editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) $setBlocksType(selection, () => (active.block === 'heading' ? $createParagraphNode() : $createHeadingNode('h2')));
  });
  const list = (type: 'bullet' | 'number') => {
    if (active.block === type) editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    else editor.dispatchCommand(type === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined);
  };
  const link = () => {
    if (active.link) return editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    setLinking(editor.getEditorState().read(() => $getSelection()?.clone() ?? null));
  };
  const closeLink = (url: string | null) => {
    const selection = linking;
    setLinking(null);
    if (url && selection) editor.update(() => {
      $setSelection(selection.clone());
      $toggleLink(url);
    });
    editor.focus();
  };
  return (
    <div role="toolbar" aria-label="Formatting" className="flex shrink-0 items-center gap-0.5 border-b border-base-300/70 px-2 py-1">
      <ToolButton label="Bold" keys={`${MOD}B`} on={active.bold} icon={<Bold />} run={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} />
      <ToolButton label="Italic" keys={`${MOD}I`} on={active.italic} icon={<Italic />} run={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} />
      <span className="mx-1 h-4 w-px bg-base-300" />
      <ToolButton label="Heading" keys="#" on={active.block === 'heading'} icon={<Heading />} run={heading} />
      <ToolButton label="Bulleted list" keys="-" on={active.block === 'bullet'} icon={<List />} run={() => list('bullet')} />
      <ToolButton label="Numbered list" keys="1." on={active.block === 'number'} icon={<ListOrdered />} run={() => list('number')} />
      <LinkField open={linking !== null} close={closeLink}>
        <ToolButton label="Link" on={active.link} icon={<Link />} run={link} />
      </LinkField>
      <span className="ms-auto pe-1 text-[11px] text-(--muted-foreground)">Markdown</span>
    </div>
  );
}
