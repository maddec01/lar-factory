// The item dialog's description edit: Edit opens it on the loaded description, Save posts the draft as Markdown to the
// board, which writes it to GitHub or Azure DevOps, then reads the details again and closes it; a failed save keeps the
// draft and its error. A save whose reload fails closes it too and keeps the Markdown it wrote, which stands for the
// description until a reload goes through, so the dialog shows it and Edit opens on it rather than on the old text, and
// drops the item's cached details, so a reopen reads them again.
// Cancel drops it. Opening it is no change: the draft counts as changed only once it differs from the editor's own
// Markdown of the description.

import { useCallback, useState } from 'react';
import type { DescriptionSave } from '@lar-factory/shared';
import { postAction } from '../items/card-actions.ts';
import { detailsCache } from './details-cache.ts';
import type { ItemDetailsRead } from './use-item-details.ts';

interface Editing {
  /** The editor's Markdown of the description it opened on; null until it reports it. */
  baseline: string | null;
  /** The Markdown as last edited; null before the first edit. */
  draft: string | null;
  saving: boolean;
  error: string | null;
}

export interface DescriptionEdit {
  editing: boolean;
  /** Whether the draft differs from the description it opened on. */
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** The Markdown the last save wrote while the details have not been read again since, as theirs predates it; else null. */
  saved: string | null;
  start: () => void;
  cancel: () => void;
  change: (markdown: string) => void;
  setBaseline: (markdown: string) => void;
  save: () => Promise<void>;
}

export function useDescriptionEdit(itemId: string, read: ItemDetailsRead, refresh: () => Promise<boolean>): DescriptionEdit {
  const [state, setState] = useState<Editing | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const update = useCallback((patch: Partial<Editing>) => setState((shown) => shown && { ...shown, ...patch }), []);
  // Stable, as the editor reads its baseline once per callback it is given.
  const change = useCallback((draft: string) => update({ draft }), [update]);
  const setBaseline = useCallback((baseline: string) => update({ baseline }), [update]);
  const dirty = state?.draft != null && state.draft !== state.baseline;
  return {
    editing: state !== null,
    dirty,
    saving: state?.saving ?? false,
    error: state?.error ?? null,
    saved,
    start: () => setState({ baseline: null, draft: null, saving: false, error: null }),
    cancel: () => setState(null),
    change,
    setBaseline,
    async save() {
      if (!state || state.draft === null || read.state !== 'loaded') return;
      const { bodyField, revision } = read.details;
      const save: DescriptionSave = { itemId, body: state.draft, ...bodyField && { bodyField }, ...revision !== undefined && { revision } };
      update({ saving: true, error: null });
      const result = await postAction('/api/item-description', save);
      if (result.error) return update({ saving: false, error: result.error });
      // The cached details predate the save; a reload that works caches the new ones.
      detailsCache.drop(itemId);
      setSaved((await refresh()) ? null : save.body);
      setState(null);
    },
  };
}
