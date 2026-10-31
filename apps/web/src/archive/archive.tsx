// Settings › Archive: each piece of work off the board, set aside or finished and hidden by retention, with Export
// markdown, Restore for set-aside work and Close ticket while its ticket is open, and this Mac's retention setting. A
// new timed delete names the work it would delete now and saves only on its own confirm. Restore and a saved setting
// read Archive again.

import { useState } from 'react';
import { flushSync } from 'react-dom';
import { clock, day, type Item, type RetentionState } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Input } from '@lar-factory/ui/design-system/Input';
import { kind } from '../buttons/button-kinds.tsx';
import { ExportedLine, ExportMarkdown, type Exported } from '../item-dialog/record-text.tsx';
import { useAbandonStore } from '../items/abandon-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { useArchiveStore } from './archive-store.ts';
import { Choice } from '../settings/controls.tsx';

/** Where the work stands in Archive: set aside, or finished on its day. */
export function archivedAs(item: Item): string {
  if (item.archived?.setAside) return 'Set aside';
  return item.closedAt ? `Finished ${day(item.closedAt, undefined)}` : 'Finished';
}

/** Export markdown, Restore for set-aside work, and Close ticket while the board sees its ticket open. */
export function ArchiveActions({ item }: { item: Item }) {
  const [exported, setExported] = useState<Exported>({ state: 'idle' });
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeable = item.archived?.setAside && item.archived.ticketOpen && item.number > 0 && !item.abandonRefusal;
  const restore = async () => {
    setRestoring(true);
    setError(null);
    const result = await postAction('/api/restore', { itemId: item.id });
    // A restored item leaves Archive with this row, once Archive is read again.
    if (!result.error) await useArchiveStore.getState().load();
    flushSync(() => {
      receive(result);
      setRestoring(false);
      setError(result.error);
    });
  };
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-2">
        <ExportMarkdown itemId={item.id} exported={exported} setExported={setExported} />
        {closeable && <Button {...kind('other')} data-archive-close={item.id} onClick={() => useAbandonStore.getState().askClose(item)}>Close ticket</Button>}
        {item.archived?.setAside && <Button {...kind('other')} data-restore={item.id} loading={restoring} onClick={() => void restore()}>Restore</Button>}
      </span>
      <ExportedLine exported={exported} />
      {error && <p className="m-0 text-xs text-(--error-foreground)" role="alert">{error}</p>}
    </span>
  );
}

/** What saving a timed delete asks before it saves: the work it would delete now. */
type Due = { workId: string; title: string }[];

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** A whole number of days from 0, or null for anything else. */
function wholeDays(text: string): number | null {
  const n = Number(text);
  return text.trim() !== '' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** What the last timed delete did, naming each piece of work it kept and why. */
function LastDelete({ lastDelete }: { lastDelete: NonNullable<RetentionState['lastDelete']> }) {
  return (
    <div className="grid gap-1 text-xs text-(--muted-foreground)" data-last-delete>
      <p className="m-0">The last timed delete, {day(lastDelete.at, undefined)} at {clock(lastDelete.at, undefined)}, deleted {lastDelete.deleted.length} {lastDelete.deleted.length === 1 ? 'record' : 'records'}.</p>
      {lastDelete.kept.length > 0 && <ul className="m-0 grid gap-0.5 pl-4">
        {lastDelete.kept.map((k) => <li key={k.workId}>Kept {k.workId}. {k.reason}</li>)}
      </ul>}
    </div>
  );
}

/**
 * When finished and set-aside work leaves the board, and whether the board deletes it later. Saving a new timed delete
 * asks first, naming the work it would delete now, so Export markdown and Restore are still there for it.
 */
export function RetentionSetting({ retention }: { retention: RetentionState }) {
  const [hide, setHide] = useState(String(retention.hideAfterDays));
  const [deleting, setDeleting] = useState(retention.deleteAfterDays !== null);
  const [deleteAfter, setDeleteAfter] = useState(String(retention.deleteAfterDays ?? 30));
  const [due, setDue] = useState<Due | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const hideDays = wholeDays(hide);
  const deleteDays = deleting ? wholeDays(deleteAfter) : null;
  const invalid = hideDays === null || (deleting && deleteDays === null);

  const save = async (confirmed = false) => {
    setSaving(true);
    setMessage(null);
    const result = await postAction<{ saved: boolean; due: Due }>('/api/retention', { hideAfterDays: hideDays, deleteAfterDays: deleteDays, confirmed });
    // A saved setting can hide, show or delete work in Archive.
    if (result.saved) await useArchiveStore.getState().load();
    flushSync(() => {
      receive(result);
      setSaving(false);
      if (result.error) setMessage({ text: result.error, error: true });
      else if (result.saved === false) setDue(result.due ?? []);
      else {
        setDue(null);
        setMessage({ text: 'Saved the retention setting on this Mac.', error: false });
      }
    });
  };

  if (retention.problem) return <p className="m-0 text-xs text-(--error-foreground)" role="alert">{retention.problem} The board keeps and shows all work until the setting can be read.</p>;
  return (
    <div className="grid gap-3" data-retention>
      <label className="flex items-center gap-2 text-sm">
        Hide finished and set-aside work after
        <Input className="w-20" inputMode="numeric" aria-label="Days before hiding" value={hide} disabled={saving} onChange={(e) => setHide(e.target.value)} />
        days
      </label>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Choice label="Delete hidden work" value={deleting ? 'delete' : 'keep'} busy={saving} onChange={(next) => { setDeleting(next === 'delete'); setDue(null); }}
          options={[{ value: 'keep', label: 'Keep it' }, { value: 'delete', label: 'Delete it after' }]} />
        {deleting && <span className="flex items-center gap-2">
          <Input className="w-20" inputMode="numeric" aria-label="Days before deleting" value={deleteAfter} disabled={saving} onChange={(e) => { setDeleteAfter(e.target.value); setDue(null); }} />
          days
        </span>}
      </div>
      {due ? (
        <div className="grid gap-2 rounded-lg border border-(--border) p-3 text-sm" role="alertdialog" aria-label="Turn on timed delete" data-delete-confirm>
          <p className="m-0">{due.length
            ? `Turning on timed delete deletes this work now, with its brief, threads and reviews. Export or restore it below first.`
            : `Nothing is old enough to delete now. Work will be deleted ${days(deleteDays ?? 0)} after it's finished or set aside.`}</p>
          {due.length > 0 && <ul className="m-0 grid gap-0.5 pl-4">{due.map((d) => <li key={d.workId}>{d.title || d.workId}</li>)}</ul>}
          <span className="flex gap-2">
            <Button {...kind('other')} onClick={() => setDue(null)}>Cancel</Button>
            <Button {...kind('main', 'danger')} loading={saving} data-confirm-delete onClick={() => void save(true)}>
              {due.length ? `Delete ${due.length} now` : 'Turn on timed delete'}
            </Button>
          </span>
        </div>
      ) : <span><Button {...kind('other')} disabled={invalid} loading={saving} data-save-retention onClick={() => void save()}>Save</Button></span>}
      {invalid && <p className="m-0 text-xs text-(--error-foreground)">Enter whole days from 0.</p>}
      {message && <p className={`m-0 text-xs ${message.error ? 'text-(--error-foreground)' : 'text-(--muted-foreground)'}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {retention.lastDelete && <LastDelete lastDelete={retention.lastDelete} />}
    </div>
  );
}
