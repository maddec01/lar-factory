// The item dialog's label edit: opening the picker reads the tracker's labels, as the tracker holds the only list, and
// each toggle writes one label through the board. The row changes from the board the write answers with, so a failed
// write leaves it as it was and keeps its error. One write runs at a time, as an Azure write fails if another changed
// the work item since its read.

import { useCallback, useRef, useState } from 'react';
import { sameLabel } from '@lar-factory/shared';
import type { Item, TrackerLabel } from '@lar-factory/shared';
import { postAction, receive } from '../items/card-actions.ts';
import type { LabelChoice } from '../labels/label-picker.tsx';

const NOT_READ = 'Could not reach the board to read the labels.';

export function useLabelEdit(item: Pick<Item, 'id' | 'labels'>) {
  const [choices, setChoices] = useState<LabelChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Set at once, so a second toggle before the render that follows the first still waits. */
  const writing = useRef(false);
  const itemId = item.id;
  const read = useCallback(async () => {
    setChoices(null);
    setError(null);
    try {
      const response = await fetch(`/api/item-labels?itemId=${encodeURIComponent(itemId)}`, { cache: 'no-store' });
      const body = await response.json() as { labels?: TrackerLabel[]; error?: string };
      if (body.labels) setChoices(body.labels.map(({ color, ...label }) => ({ ...label, ...color && { color: `#${color}` } })));
      else setError(body.error ?? NOT_READ);
    } catch { setError(NOT_READ); }
  }, [itemId]);
  const toggle = async (label: string) => {
    if (writing.current) return;
    writing.current = true;
    setSaving(true);
    setError(null);
    const result = await postAction('/api/item-labels', { itemId, label, action: item.labels.some((name) => sameLabel(name, label)) ? 'remove' : 'add' });
    if (result.error) setError(result.error);
    else receive(result);
    writing.current = false;
    setSaving(false);
  };
  return { choices, error, saving, read, toggle };
}
