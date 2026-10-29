// The expand control a dialog's header shows: the button, or ⌘⇧E (Ctrl+Shift+E off a Mac), grows the dialog to the
// window less a small margin and back, even while focus is in a field.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { IconButton } from '@lar-factory/ui/design-system/IconButton';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/design-system/Tooltip';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = MAC ? '⌘⇧E' : 'Ctrl+Shift+E';

/** The expanded dialog's size, inline so it wins over the Modal Copy's own size classes. */
export const EXPANDED: CSSProperties = { width: 'calc(100vw - 2rem)', maxWidth: 'none', height: 'calc(100dvh - 2rem)', maxHeight: 'none' };

/** Whether the dialog is expanded, and a toggle; the shortcut toggles it too, unless `paused` while a prompt sits on top. */
export function useExpand(paused = false): readonly [boolean, () => void] {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (paused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e' || !event.shiftKey || event.altKey || !(MAC ? event.metaKey : event.ctrlKey)) return;
      event.preventDefault();
      setExpanded((on) => !on);
    };
    // Captured, so a field that handles its own keys, such as the description editor, still lets it through.
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [paused]);
  return [expanded, () => setExpanded((on) => !on)] as const;
}

export function ExpandButton({ expanded, toggle }: { expanded: boolean; toggle: () => void }) {
  const label = expanded ? 'Restore size' : 'Expand';
  // Hover only: a dialog that opens with no field focuses this button, and a tooltip opened by that focus would take
  // the dialog's first Escape. aria-keyshortcuts still tells assistive tech the shortcut.
  const [hint, setHint] = useState(false);
  return (
    <Tooltip open={hint} onOpenChange={(open) => setHint(open && document.querySelector('button[data-expand]:hover') !== null)}>
      <TooltipTrigger asChild>
        <IconButton data-expand variant="header" aria-label={label} aria-pressed={expanded} aria-keyshortcuts={MAC ? 'Meta+Shift+E' : 'Control+Shift+E'}
          icon={expanded ? <Minimize2 /> : <Maximize2 />} onClick={toggle} />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}<span className="ms-2 text-base-500">{SHORTCUT}</span></TooltipPopup>
    </Tooltip>
  );
}
