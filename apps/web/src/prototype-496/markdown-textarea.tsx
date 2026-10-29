// PROTOTYPE #496, throwaway. Editor A: a Markdown textarea with smart lists and Write/Preview tabs, like GitHub's.
// Enter after "- item" continues the list, Enter on an empty item ends it, numbered lists count up, Tab and Shift+Tab
// indent list lines, and a pasted list keeps its markers (bullets like "•" become "- ") and the current indent.

import { useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { RichText } from '@lar-factory/ui/rich-text';
import { Textarea } from '@lar-factory/ui/design-system/Textarea';

const ITEM = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/;

/** Replaces [from, to) with text through the browser, so undo still works. */
function replace(area: HTMLTextAreaElement, from: number, to: number, text: string) {
  area.setSelectionRange(from, to);
  if (!document.execCommand('insertText', false, text)) area.setRangeText(text, from, to, 'end');
}

function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  const area = event.currentTarget;
  const { value, selectionStart: start, selectionEnd: end } = area;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndAt = value.indexOf('\n', start);
  const lineEnd = lineEndAt < 0 ? value.length : lineEndAt;
  const line = value.slice(lineStart, lineEnd);
  const match = ITEM.exec(line);

  if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.nativeEvent.isComposing && match && start === end) {
    const [, indent, marker, number, dot, gap, task, text] = match;
    const markerEnd = lineStart + indent!.length + marker!.length + gap!.length + (task?.length ?? 0);
    if (start < markerEnd) return;
    event.preventDefault();
    if (!text!.trim() && start === lineEnd) {
      // An empty item ends the list: a nested one steps out a level, a top-level one becomes a blank line.
      replace(area, lineStart, lineEnd, indent!.length >= 2 ? `${indent!.slice(2)}${marker}${gap}${task ?? ''}` : '');
      return;
    }
    const next = number ? `${Number(number) + 1}${dot}` : marker;
    replace(area, start, end, `\n${indent}${next}${gap}${task ? '[ ] ' : ''}`);
    return;
  }

  if (event.key === 'Tab' && !event.metaKey && !event.altKey) {
    const blockEndAt = value.indexOf('\n', end);
    const block = value.slice(lineStart, blockEndAt < 0 ? value.length : blockEndAt);
    const lines = block.split('\n');
    // Only list lines, or a selection of several lines, indent; else Tab moves focus as usual.
    if (!match && lines.length < 2) return;
    event.preventDefault();
    const changed = lines.map((l) => (event.shiftKey ? l.replace(/^ {1,2}/, '') : `  ${l}`)).join('\n');
    if (changed === block) return;
    replace(area, lineStart, lineStart + block.length, changed);
    const shift = changed.split('\n')[0]!.length - lines[0]!.length;
    area.setSelectionRange(Math.max(lineStart, start + shift), end + (changed.length - block.length));
  }
}

function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
  const area = event.currentTarget;
  const text = event.clipboardData.getData('text/plain');
  if (!text.includes('\n')) return;
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^(\s*)[•◦▪‣–]\s*/, '$1- '));
  if (!lines.some((l) => ITEM.test(l))) return;
  event.preventDefault();
  const { value, selectionStart: start, selectionEnd: end } = area;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const here = ITEM.exec(value.slice(lineStart, start));
  // Pasted inside a list, every pasted line takes the list's indent.
  const indent = here?.[1] ?? '';
  const pasted = lines.map((l, i) => (i === 0 ? (here && ITEM.test(l) ? l.replace(ITEM, '$7') : l) : `${indent}${l}`)).join('\n');
  replace(area, start, end, pasted);
}

export function MarkdownTextarea({ value, onChange, fill = false, label }: { value: string; onChange: (value: string) => void; fill?: boolean; label: string }) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const ref = useRef<HTMLTextAreaElement>(null);
  const tabClass = (t: string) => `rounded-t-md border-x border-t px-3 py-1 text-xs ${tab === t ? 'border-base-300 bg-base-100 font-medium' : 'border-transparent text-(--muted-foreground)'}`;
  return (
    <div className={`grid min-h-0 gap-0 ${fill ? 'flex-1 grid-rows-[auto_minmax(0,1fr)_auto]' : ''}`}>
      <div role="tablist" aria-label={label} className="-mb-px flex gap-1">
        <button type="button" role="tab" aria-selected={tab === 'write'} className={tabClass('write')} onClick={() => { setTab('write'); requestAnimationFrame(() => ref.current?.focus()); }}>Write</button>
        <button type="button" role="tab" aria-selected={tab === 'preview'} className={tabClass('preview')} onClick={() => setTab('preview')}>Preview</button>
      </div>
      {tab === 'write'
        ? <Textarea ref={ref} aria-label={label} value={value} onChange={(e) => onChange(e.currentTarget.value)} onKeyDown={onKeyDown} onPaste={onPaste}
            rows={fill ? undefined : 8} className={`font-mono text-[13px] ${fill ? 'h-full min-h-40 resize-none' : ''}`} placeholder="Markdown: - lists, 1. steps, ## headings, **bold**" />
        : <div className={`overflow-y-auto rounded-md border border-base-300 p-3 ${fill ? 'h-full min-h-40' : 'min-h-40'}`}>
            {value.trim() ? <RichText text={value} format="markdown" /> : <p className="m-0 text-sm text-(--muted-foreground)">Nothing to preview.</p>}
          </div>}
      <p className="m-0 pt-1 text-xs text-(--muted-foreground)">Markdown. Enter continues a list, Tab indents it.</p>
    </div>
  );
}
