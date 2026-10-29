// PROTOTYPE #496, throwaway, mock data only, nothing is written. Four variants on one page, switched by ?variant=:
// A and B differ only in the description editor (A: Markdown textarea with smart lists and Write/Preview; B: Lexical
// live formatting), in today's Add item layout and in the item dialog's Edit description. X and Y differ only in the
// Add item layout (X: one wide column, editor fills, labels as chips; Y: two columns, side panel), both with editor A.
// Labels are grouped by the text before ": " in every variant.
// Round 2 adds YB: layout Y with editor B filling the left column, the "Only for" checkbox on Azure repositories, and an
// item dialog whose Edit asks "Discard changes?" before Escape or a click outside drops unsaved changes.

import '../prototype.css';
import { StrictMode, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Field } from '@lar-factory/ui/design-system/Field';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { RichText } from '@lar-factory/ui/rich-text';
import { TooltipProvider } from '@lar-factory/ui/design-system/Tooltip';
import { kind } from '../buttons/button-kinds.tsx';
import { ITEM, KINDS, REPOS, groupLabels } from './mock.ts';
import { MarkdownTextarea } from './markdown-textarea.tsx';
import { LiveEditor } from './live-editor.tsx';

const VARIANTS = { A: 'Editor: Markdown + smart lists', B: 'Editor: live formatting (Lexical)', X: 'Layout: one wide column', Y: 'Layout: two columns', YB: 'Round 2: layout Y with editor B' } as const;
type Variant = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as Variant[];

type EditorProps = { value: string; onChange: (value: string) => void; fill?: boolean; label: string };
const editorFor = (variant: Variant) => (variant === 'B' || variant === 'YB' ? LiveEditor : MarkdownTextarea) as (props: EditorProps) => ReactNode;

type Draft = { repo: string; kind: string; title: string; description: string; labels: string[]; onlyFor: boolean };
const EMPTY: Draft = { repo: REPOS[0]!.repo, kind: '', title: '', description: '', labels: [], onlyFor: true };

// --- labels -------------------------------------------------------------------------------------------------------

function toggle(draft: Draft, label: string, set: (d: Draft) => void) {
  set({ ...draft, labels: draft.labels.includes(label) ? draft.labels.filter((l) => l !== label) : [...draft.labels, label] });
}

/** Grouped checkboxes: a small heading per prefix, the unprefixed labels last with none. */
function LabelChecks({ draft, set, column = false }: { draft: Draft; set: (d: Draft) => void; column?: boolean }) {
  const repo = REPOS.find((r) => r.repo === draft.repo)!;
  return (
    <fieldset className="m-0 grid gap-3 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-medium">Labels</legend>
      {groupLabels(repo.labels).map(({ prefix, options }) => (
        <div key={prefix || '-'} role="group" aria-label={prefix || 'Other labels'} className="grid gap-1.5">
          {prefix && <span className="text-xs font-medium uppercase tracking-wide text-(--muted-foreground)">{prefix}</span>}
          <div className={column ? 'grid gap-1.5' : 'flex flex-wrap gap-x-4 gap-y-1.5'}>
            {options.map((o) => <Checkbox key={o.label} label={o.text} checked={draft.labels.includes(o.label)} onChange={() => toggle(draft, o.label, set)} />)}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

/** Grouped toggle chips, one row per prefix with the prefix at its start. */
function LabelChips({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  const repo = REPOS.find((r) => r.repo === draft.repo)!;
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-medium">Labels</legend>
      {groupLabels(repo.labels).map(({ prefix, options }) => (
        <div key={prefix || '-'} role="group" aria-label={prefix || 'Other labels'} className="flex flex-wrap items-center gap-1.5">
          <span className="w-14 shrink-0 text-xs font-medium text-(--muted-foreground)">{prefix}</span>
          {options.map((o) => {
            const on = draft.labels.includes(o.label);
            return (
              <button key={o.label} type="button" aria-pressed={on} onClick={() => toggle(draft, o.label, set)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? 'border-(--primary) bg-(--primary) text-(--primary-foreground)' : 'border-base-300 bg-base-100 hover:bg-base-200'}`}>
                {o.text}
              </button>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}

/** Only for <repo>, on an Azure repository only. */
function OnlyFor({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  const repo = REPOS.find((r) => r.repo === draft.repo)!;
  if (!repo.azure) return null;
  return (
    <div className="grid gap-1">
      <Checkbox label={`Only for ${repo.name}`} checked={draft.onlyFor} onChange={() => set({ ...draft, onlyFor: !draft.onlyFor })} />
      <p className="m-0 text-xs text-(--muted-foreground)">Unticked, it appears for every repository that reads the {repo.azure.team} team's backlog and current sprint.</p>
    </div>
  );
}

// --- add item -----------------------------------------------------------------------------------------------------

function RepoKind({ draft, set, stacked = false }: { draft: Draft; set: (d: Draft) => void; stacked?: boolean }) {
  return (
    <div className={stacked ? 'grid gap-3' : 'grid grid-cols-2 gap-3'}>
      <Field id="p-repo" label="Repository" className="grid gap-1">
        <NativeSelect value={draft.repo} onChange={(e) => set({ ...draft, repo: e.currentTarget.value, labels: [] })}>
          {REPOS.map((r) => <option key={r.repo} value={r.repo}>{r.name}</option>)}
        </NativeSelect>
      </Field>
      <Field id="p-kind" label="Kind" className="grid gap-1">
        <NativeSelect value={draft.kind} onChange={(e) => set({ ...draft, kind: e.currentTarget.value })}>
          <option value="">Choose a kind</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </NativeSelect>
      </Field>
    </div>
  );
}

const Title = ({ draft, set }: { draft: Draft; set: (d: Draft) => void }) => (
  <Field id="p-title" label="Title (required)" className="grid gap-1">
    <Input value={draft.title} autoComplete="off" onChange={(e) => set({ ...draft, title: e.currentTarget.value })} />
  </Field>
);

const Footer = ({ onClose }: { onClose: () => void }) => (
  <Modal.Footer>
    <Button {...kind('main')} type="button" onClick={onClose}>Add to List</Button>
  </Modal.Footer>
);

function AddItemModal({ variant, draft, set, onClose }: { variant: Variant; draft: Draft; set: (d: Draft) => void; onClose: () => void }) {
  const Editor = editorFor(variant);
  const description = (fill: boolean) => (
    <div className={`grid gap-1 ${fill ? 'min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]' : ''}`}>
      <span className="text-sm font-medium">Description (optional)</span>
      <Editor key={variant} label="Description" value={draft.description} onChange={(description) => set({ ...draft, description })} fill={fill} />
    </div>
  );
  const intro = <Text tone="muted" className="shrink-0 px-5 pb-4 sm:px-6">Create an issue in {REPOS.find((r) => r.repo === draft.repo)!.name} and add it to List.</Text>;

  if (variant === 'X') return (
    <Modal onClose={onClose}>
      <Modal.Content title="Add item" presentation="paned" accessibleTitle="Add item">
        {intro}
        <Modal.Body layout="fill">
          <Title draft={draft} set={set} />
          <RepoKind draft={draft} set={set} />
          {description(true)}
          <LabelChips draft={draft} set={set} />
        </Modal.Body>
        <Footer onClose={onClose} />
      </Modal.Content>
    </Modal>
  );

  if (variant === 'Y' || variant === 'YB') return (
    <Modal onClose={onClose}>
      <Modal.Content title="Add item" presentation="paned">
        {intro}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_15rem] border-t border-base-300">
          <div className="flex min-h-0 flex-col gap-3 px-5 py-4 sm:px-6">
            <Title draft={draft} set={set} />
            {description(true)}
          </div>
          <aside className="grid content-start gap-4 overflow-y-auto border-l border-base-300 bg-base-50/60 px-4 py-4">
            <RepoKind draft={draft} set={set} stacked />
            {variant === 'YB' && <OnlyFor draft={draft} set={set} />}
            <LabelChecks draft={draft} set={set} column />
          </aside>
        </div>
        <Footer onClose={onClose} />
      </Modal.Content>
    </Modal>
  );

  // A and B: today's layout, with grouped labels and the variant's editor.
  return (
    <Modal onClose={onClose}>
      <Modal.Content title="Add item" description="Capture work for a repository.">
        <Modal.Body>
          <div className="grid gap-4">
            <RepoKind draft={draft} set={set} />
            <LabelChecks draft={draft} set={set} />
            <Title draft={draft} set={set} />
            {description(false)}
          </div>
        </Modal.Body>
        <Footer onClose={onClose} />
      </Modal.Content>
    </Modal>
  );
}

// --- item dialog --------------------------------------------------------------------------------------------------

function ItemDialogMock({ variant, onClose }: { variant: Variant; onClose: () => void }) {
  const Editor = editorFor(variant);
  const [saved, setSaved] = useState(ITEM.description);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  // YB: Escape or a click outside with unsaved changes asks first.
  const close = () => (variant === 'YB' && editing !== null && editing !== saved ? setAsking(true) : onClose());
  return (
    <>
    <Modal onClose={close}>
      <Modal.Content title={`${ITEM.ref} ${ITEM.title}`} presentation="workspace">
        <div className="shrink-0 border-b border-base-300 px-5 pb-3 text-xs text-base-700 sm:px-6">lar · List · updated 2h ago</div>
        <Modal.Body>
          <div className="grid max-w-3xl gap-5 pt-3">
            <div className="flex flex-wrap items-center gap-1.5 text-sm"><span className="text-xs text-(--muted-foreground)">Labels</span>{ITEM.labels.map((l) => <Badge key={l}>{l}</Badge>)}</div>
            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="m-0 text-[13px] font-medium text-(--muted-foreground)">Description</h2>
                {editing === null && <Button {...kind('other')} leftIcon={<Pencil />} onClick={() => { setEditing(saved); setNote(''); }}>Edit</Button>}
              </div>
              {editing === null
                ? <>{saved ? <RichText text={saved} format="markdown" /> : <p className="m-0 text-sm text-(--muted-foreground)">No description.</p>}
                    {note && <p className="m-0 text-xs text-(--success)" role="status">{note}</p>}</>
                : <div className="grid gap-2">
                    <Editor key={variant} label="Description" value={editing} onChange={setEditing} />
                    <div className="flex justify-end gap-2">
                      <Button {...kind('other')} onClick={() => setEditing(null)}>Cancel</Button>
                      <Button {...kind('main')} onClick={() => { setSaved(editing); setEditing(null); setNote('Saved (prototype: nothing was written to GitHub).'); }}>Save</Button>
                    </div>
                  </div>}
            </section>
            <section className="grid gap-2">
              <h2 className="m-0 text-[13px] font-medium text-(--muted-foreground)">Comments · 1</h2>
              <div className="rounded-(--radius-lg) border border-base-300 px-3 py-2 text-sm">Repro on iOS 26 only.</div>
            </section>
          </div>
        </Modal.Body>
        <Modal.Footer><Button {...kind('other')} onClick={close}>Close</Button></Modal.Footer>
      </Modal.Content>
    </Modal>
    {asking && (
      <Modal onClose={() => setAsking(false)}>
        <Modal.Content title="Discard changes?" description="Your edits to the description haven't been saved.">
          <Modal.Footer>
            <Button {...kind('other')} onClick={() => setAsking(false)}>Keep editing</Button>
            <Button {...kind('main')} onClick={() => { setAsking(false); onClose(); }}>Discard</Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal>
    )}
    </>
  );
}

// --- page, state and switcher -------------------------------------------------------------------------------------

const params = () => new URLSearchParams(location.search);
const readVariant = (): Variant => (KEYS.find((k) => k === params().get('variant')) ?? 'A');

function setParam(name: string, value: string | null) {
  const p = params();
  if (value === null) p.delete(name); else p.set(name, value);
  history.replaceState(null, '', `?${p}`);
}

/** The floating bar. data-slot="toaster" makes the design system's Modal ignore clicks on it rather than close. */
function Switcher({ variant, go }: { variant: Variant; go: (v: Variant) => void }) {
  const step = (by: number) => go(KEYS[(KEYS.indexOf(variant) + by + KEYS.length) % KEYS.length]!);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  return (
    <div data-slot="toaster" className="pointer-events-auto fixed bottom-4 left-1/2 z-[2147483647] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-2 py-1.5 text-sm text-white shadow-xl">
      <button type="button" aria-label="Previous variant" className="rounded-full p-1 hover:bg-white/20" onClick={() => step(-1)}><ChevronLeft className="size-4" /></button>
      <span className="min-w-64 text-center"><b>{variant}</b> ({VARIANTS[variant]})</span>
      <button type="button" aria-label="Next variant" className="rounded-full p-1 hover:bg-white/20" onClick={() => step(1)}><ChevronRight className="size-4" /></button>
    </div>
  );
}

function Page() {
  const [variant, setVariant] = useState(readVariant);
  const [open, setOpen] = useState<string | null>(() => params().get('open') ?? 'add');
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, title: 'Show lyrics while playing', labels: ['app: music'], onlyFor: true, description: '- Lyrics under the artwork\n- Scroll with the song' });
  const go = (v: Variant) => { setVariant(v); setParam('variant', v); };
  const show = (o: string | null) => { setOpen(o); setParam('open', o); };
  const itemDialog = variant !== 'X' && variant !== 'Y';
  return (
    <TooltipProvider>
      <div className="grid gap-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="mr-2">PROTOTYPE #496</strong>
          <Button {...kind('main')} onClick={() => show('add')}>Add item</Button>
          <Button {...kind('other')} onClick={() => show('item')}>Open {ITEM.ref} {ITEM.title}</Button>
          <Button {...kind('other')} onClick={() => setDraft(EMPTY)}>Clear draft</Button>
          {!itemDialog && <span className="text-xs text-(--muted-foreground)">X and Y are layout variants; the item dialog uses editor A.</span>}
        </div>
        <p className="m-0 max-w-3xl text-sm text-(--muted-foreground)">Throwaway, mock data, nothing is written. ← → or the bar below switch variants (?variant=A|B|X|Y|YB, ?open=add|item).</p>
      </div>
      {/* The draft's state, above the modal's overlay. */}
      <pre className="pointer-events-none fixed right-3 top-3 z-[2147483647] m-0 max-h-[40vh] w-80 overflow-hidden whitespace-pre-wrap rounded-md bg-black/85 p-3 font-mono text-[11px] text-white shadow-xl">
        {JSON.stringify(draft, null, 1)}
      </pre>
      {open === 'add' && <AddItemModal variant={variant} draft={draft} set={setDraft} onClose={() => show(null)} />}
      {open === 'item' && <ItemDialogMock key={variant} variant={variant} onClose={() => show(null)} />}
      <Switcher variant={variant} go={go} />
    </TooltipProvider>
  );
}

createRoot(document.getElementById('app')!).render(<StrictMode><Page /></StrictMode>);
