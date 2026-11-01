// Settings' Labels section. The tracker holds the only copy, so the section reads it each time and keeps no list. It reads
// the capability description for what the tracker's labels have, and never checks a provider's name.
import { useEffect, useState, type FormEvent } from 'react';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { trackerCapabilities, writeAccessProblem, type RepositorySetup, type TrackerCapabilities, type TrackerLabel } from '@lar-factory/shared';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { kind } from '../buttons/button-kinds.tsx';
import { postAction } from '../items/card-actions.ts';
import { tint } from '../items/item-parts.tsx';
import { useEditStore, type LabelChange } from './edit-store.ts';
import { KIND_NAMES, type VocabularyKind } from './vocabulary-editor.tsx';

const SWATCHES = ['D73A4A', 'E99695', 'FBCA04', '0E8A16', 'C2E0C6', 'BFDADC', '1D76DB', '5319E7', 'D4C5F9', 'EDEDED'];

const capitalized = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const OTHER_MAPPINGS = "Kind mappings in the project's other onboarded repositories update too.";

/** The kind mappings holding `name` in this repository, as a sentence names them, or null when none does. */
function mappingsOf(name: string, setup: RepositorySetup): string | null {
  const kinds = (Object.keys(KIND_NAMES) as VocabularyKind[]).filter((key) => setup.vocabulary[key].labels.some((label) => label.toLowerCase() === name.toLowerCase())).map((key) => KIND_NAMES[key]);
  return kinds.length ? `the ${new Intl.ListFormat('en').format(kinds)} mapping${kinds.length > 1 ? 's' : ''}` : null;
}

function ProblemText({ children }: { children: string | null }) {
  return children && <p className="m-0 text-xs text-(--error-foreground)" role="alert">{children}</p>;
}

/** The tracker's labels by name, read again by `retry` while the last read stays on screen. */
function useTrackerLabels(repo: string) {
  const [labels, setLabels] = useState<TrackerLabel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void postAction<{ labels: TrackerLabel[] }>('/api/repositories/labels', { repo, change: 'list' }).then((result) => {
      if (!current) return;
      setError(result.error ?? (result.labels ? null : 'The board sent no labels.'));
      setLabels(result.labels ? [...result.labels].sort((a, b) => a.name.localeCompare(b.name)) : null);
    });
    return () => { current = false; };
  }, [repo, attempt]);
  return { labels, error, retry: () => setAttempt((n) => n + 1) };
}

/** The change to `label` an editor's fields make: only what differs, so a tracker hears nothing it needn't. */
function changeFrom(label: TrackerLabel, draft: Required<TrackerLabel>, capabilities: TrackerCapabilities): Partial<TrackerLabel> {
  return {
    ...draft.name.trim() !== label.name && { name: draft.name.trim() },
    ...capabilities.color && draft.color !== (label.color ?? '') && { color: draft.color.replace(/^#/, '') },
    ...capabilities.description && draft.description !== (label.description ?? '') && { description: draft.description },
  };
}

function LabelEditor({ label, capabilities, mappings, onSave, onDone }: {
  label: TrackerLabel; capabilities: TrackerCapabilities; mappings: string | null; onSave: (change: LabelChange) => Promise<string | null>; onDone: () => void;
}) {
  const running = useEditStore((s) => s.running);
  const [draft, setDraft] = useState({ name: label.name, color: label.color ?? '', description: label.description ?? '' });
  const [failure, setFailure] = useState<string | null>(null);
  const Noun = capitalized(capabilities.noun);
  const update = changeFrom(label, draft, capabilities);
  const problem = draft.name.trim() === label.name ? null : capabilities.nameProblem(draft.name);
  const badColor = update.color !== undefined && !/^[0-9a-f]{6}$/i.test(update.color) ? 'Use a colour of six hex digits.' : null;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (problem || badColor || !Object.keys(update).length) return;
    const failed = await onSave({ change: 'update', name: label.name, update });
    setFailure(failed);
    if (!failed) onDone();
  };
  return <form className="grid gap-3 border-t bg-base-200/40 p-3" onSubmit={(event) => void save(event)}>
    {capabilities.changeScope === 'project' && <Alert tone="warning" title="Renaming affects the whole project">
      {capabilities.heading} belong to the project, not to this repository. Everything with this {capabilities.noun} follows the new name, in every repository of the project. {OTHER_MAPPINGS}
    </Alert>}
    <label className="grid gap-1.5 text-xs">{Noun} name
      <Input aria-label={`${Noun} name`} value={draft.name} disabled={running !== null} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
    </label>
    <ProblemText>{problem}</ProblemText>
    {mappings && update.name !== undefined && <p className="m-0 text-xs text-base-700">This also updates {mappings}.</p>}
    {capabilities.color && <div className="grid gap-1.5 text-xs">Colour
      <span className="flex flex-wrap items-center gap-1.5">
        {SWATCHES.map((hex) => <button key={hex} type="button" aria-label={`Colour #${hex}`} aria-pressed={hex.toLowerCase() === draft.color.toLowerCase()} disabled={running !== null}
          className={`size-5 rounded-full border ${hex.toLowerCase() === draft.color.toLowerCase() ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--card)' : ''}`} style={{ background: `#${hex}` }}
          onClick={() => setDraft({ ...draft, color: hex })} />)}
        <Input aria-label="Hex colour" className="w-24" value={draft.color} disabled={running !== null} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
      </span>
      <ProblemText>{badColor}</ProblemText>
    </div>}
    {capabilities.description && <label className="grid gap-1.5 text-xs">Description
      <Input aria-label={`${Noun} description`} placeholder="Optional" value={draft.description} disabled={running !== null} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
    </label>}
    <ProblemText>{failure}</ProblemText>
    <span className="flex gap-2">
      <Button {...kind('other')} type="button" disabled={running !== null} onClick={onDone}>Cancel</Button>
      <Button {...kind('other')} type="submit" disabled={running !== null || !!problem || !!badColor || !Object.keys(update).length} loading={running === 'labels'}>Save</Button>
    </span>
  </form>;
}

function DeleteConfirm({ name, capabilities, mappings, onDelete, onClose }: {
  name: string; capabilities: TrackerCapabilities; mappings: string | null; onDelete: () => Promise<string | null>; onClose: () => void;
}) {
  const running = useEditStore((s) => s.running);
  const [failure, setFailure] = useState<string | null>(null);
  const confirm = async () => {
    const failed = await onDelete();
    setFailure(failed);
    if (!failed) onClose();
  };
  return (
    <Modal loading={running !== null} onClose={onClose}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the detail names itself. */}
      <Modal.Content data-delete-label role="alertdialog" title={`Delete ${capabilities.noun} "${name}"?`} description={capabilities.deleteWarning} aria-describedby="delete-label-detail" closeOnOverlayClick={false}>
        <Modal.Body>
          <div className="grid gap-3">
            <Alert tone="danger" title={capabilities.deleteWarning}>
              <Text id="delete-label-detail" tone="muted">
                {mappings && `This also removes it from ${mappings}. `}
                {capabilities.changeScope === 'project' && `${capabilities.heading} belong to the project, so this affects the whole project. ${OTHER_MAPPINGS} `}
                This can't be undone from the factory.
              </Text>
            </Alert>
            <ProblemText>{failure}</ProblemText>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button {...kind('other')} disabled={running !== null} onClick={onClose}>Cancel</Button>
          <Button {...kind('main', 'danger')} loading={running === 'labels'} onClick={() => void confirm()}>Delete {capabilities.noun}</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}

function LabelRow({ label, capabilities, mappings, readOnly, editing, onEdit, onDelete, onSave }: {
  label: TrackerLabel; capabilities: TrackerCapabilities; mappings: string | null; readOnly: string | null; editing: boolean;
  onEdit: (editing: boolean) => void; onDelete: () => void; onSave: (change: LabelChange) => Promise<string | null>;
}) {
  const running = useEditStore((s) => s.running);
  const locked = capabilities.isManaged(label.name);
  const detail = locked ? `Factory-managed. ${capabilities.nameProblem(label.name)}` : capabilities.description ? label.description : undefined;
  const disabled = !!readOnly || running !== null;
  return <li data-label={label.name} className="border-b last:border-b-0">
    <div className="flex min-w-0 items-center gap-3 px-3 py-1.5">
      <span className="min-w-0 max-w-[45%]">
        <Badge data-label-chip className="max-w-full min-w-0" style={tint(capabilities.color && label.color ? `#${label.color}` : undefined)}>
          <span className="inline-flex min-w-0 items-center gap-1">
            {locked && <Lock className="size-3 shrink-0" aria-label="Factory-managed" />}
            <span className="truncate" title={label.name}>{label.name}</span>
          </span>
        </Badge>
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-base-700" title={detail}>{detail}</span>
      {!locked && <span className="flex shrink-0 gap-1">
        <Button {...kind('control')} data-icon-only="" aria-label={`Edit ${label.name}`} title={readOnly ?? `Edit ${label.name}`} disabled={disabled} leftIcon={<Pencil />} onClick={() => onEdit(!editing)} />
        <Button {...kind('control')} data-icon-only="" aria-label={`Delete ${label.name}`} title={readOnly ?? `Delete ${label.name}`} disabled={disabled} leftIcon={<Trash2 />} onClick={onDelete} />
      </span>}
    </div>
    {editing && <LabelEditor label={label} capabilities={capabilities} mappings={mappings} onSave={onSave} onDone={() => onEdit(false)} />}
  </li>;
}

/** The field that creates a label. Its typing stays here, so a keystroke re-renders no row. */
function CreateLabel({ capabilities, cannotCreate, showUnavailable, onCreate }: {
  capabilities: TrackerCapabilities; cannotCreate: string | null; showUnavailable: boolean; onCreate: (name: string) => Promise<string | null>;
}) {
  const { noun, createUnavailable, nameProblem } = capabilities;
  const running = useEditStore((s) => s.running);
  const [fresh, setFresh] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const problem = fresh.trim() ? nameProblem(fresh) : null;
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (cannotCreate || problem || !fresh.trim()) return;
    const failed = await onCreate(fresh.trim());
    setFailure(failed);
    if (!failed) setFresh('');
  };
  return <>
    <form className="flex gap-2" onSubmit={(event) => void create(event)}>
      <Input data-new-label aria-label={`New ${noun}`} placeholder={`New ${noun} name`} value={fresh} disabled={!!cannotCreate || running !== null} onChange={(e) => { setFresh(e.target.value); setFailure(null); }} />
      <Button {...kind('other')} type="submit" className="shrink-0" leftIcon={<Plus />} disabled={!!cannotCreate || !!problem || !fresh.trim() || running !== null}
        {...cannotCreate && { title: cannotCreate }}>Create {noun}</Button>
    </form>
    {showUnavailable && <p className="m-0 text-xs text-base-700">{createUnavailable}</p>}
    <ProblemText>{problem ?? failure}</ProblemText>
  </>;
}

/** Lists the tracker's labels with create, rename and delete in place; read-only with the reason when the access check rules them out. */
export function LabelsSection({ repo, setup }: { repo: string; setup: RepositorySetup }) {
  const capabilities = trackerCapabilities(repo);
  const { heading, changeScope, createUnavailable } = capabilities;
  const { labels, error, retry } = useTrackerLabels(repo);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const readOnly = writeAccessProblem(repo, 'manage-labels', setup.access, { azureReadOnly: setup.azureReadOnly });

  /** Sends one change, and reads the tracker again once it lands. The reason it failed, or null. */
  const change = async (body: LabelChange) => {
    const failed = await useEditStore.getState().labels(repo, body);
    if (!failed) retry();
    return failed;
  };

  return <section data-labels aria-label={heading} className="grid gap-3">
    <div className="grid gap-0.5">
      <h3 className="m-0 text-sm font-medium">{heading}</h3>
      <p className="m-0 text-xs text-base-700">Changes here write to the tracker straight away, for everyone using {changeScope === 'project' ? 'the whole project' : 'the repository'}.</p>
    </div>
    {readOnly && <Alert tone="warning" title={`${heading} are read-only here`}>{readOnly}</Alert>}
    {error
      ? <Alert tone="danger" title={`Could not read ${heading.toLowerCase()}`} action={<Button {...kind('other')} onClick={retry}>Retry</Button>}>{error}</Alert>
      : !labels
        ? <p role="status" className="m-0 text-sm text-base-700">Reading {heading.toLowerCase()}…</p>
        : <>
          <CreateLabel capabilities={capabilities} cannotCreate={readOnly ?? createUnavailable} showUnavailable={!readOnly && !!createUnavailable} onCreate={(name) => change({ change: 'create', name })} />
          {labels.length
            ? <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border p-0">
              {labels.map((label) => <LabelRow key={label.name} label={label} capabilities={capabilities} mappings={mappingsOf(label.name, setup)} readOnly={readOnly} editing={editing === label.name}
                onEdit={(open) => setEditing(open ? label.name : null)} onDelete={() => setDeleting(label.name)} onSave={change} />)}
            </ul>
            : <p className="m-0 text-xs text-base-700">No {heading.toLowerCase()} yet.</p>}
        </>}
    {deleting && <DeleteConfirm name={deleting} capabilities={capabilities} mappings={mappingsOf(deleting, setup)} onDelete={() => change({ change: 'delete', name: deleting })} onClose={() => setDeleting(null)} />}
  </section>;
}
