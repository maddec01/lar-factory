// PROTOTYPE #496, throwaway, mock data only, nothing is written. Variant YB, the user's pick, polished in round 3:
// Add item in two columns (a large title and a Lexical editor that stores Markdown on the left; repository, kind, "Only
// for" on Azure repositories and labels grouped by the text before ": " on the right), and the item dialog with Edit,
// Save/Cancel and a "Discard changes?" prompt before Escape or a click outside drops unsaved changes. The expand button
// in either header, or ⌘⇧E (Ctrl+Shift+E), grows the dialog to nearly the window's size, the editor taking the height.
// ?open=add|item picks the dialog.

import '../prototype.css';
import { StrictMode, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Maximize2, Minimize2, Pencil } from 'lucide-react';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { IconButton } from '@lar-factory/ui/design-system/IconButton';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { RichText } from '@lar-factory/ui/rich-text';
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from '@lar-factory/ui/design-system/Tooltip';
import { kind } from '../buttons/button-kinds.tsx';
import { ITEM, KINDS, REPOS, groupLabels } from './mock.ts';
import { LiveEditor } from './live-editor.tsx';

type Draft = { repo: string; kind: string; title: string; description: string; labels: string[]; onlyFor: boolean };
const EMPTY: Draft = { repo: REPOS[0]!.repo, kind: '', title: '', description: '', labels: [], onlyFor: true };
const repoOf = (draft: Draft) => REPOS.find((r) => r.repo === draft.repo)!;

// --- expand -------------------------------------------------------------------------------------------------------

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = MAC ? '⌘⇧E' : 'Ctrl+Shift+E';
// Inline, so it wins over the Copy's own size classes without touching the Copy.
const EXPANDED: CSSProperties = { width: 'calc(100vw - 2rem)', maxWidth: 'none', height: 'calc(100dvh - 2rem)', maxHeight: 'none' };

/** Expanded or not, with ⌘⇧E toggling it, even from inside the editor; `paused` while a prompt sits on top. */
function useExpand(paused = false) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || !e.shiftKey || !(MAC ? e.metaKey : e.ctrlKey)) return;
      e.preventDefault();
      setExpanded((x) => !x);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [paused]);
  return [expanded, () => setExpanded((x) => !x)] as const;
}

function ExpandButton({ expanded, toggle }: { expanded: boolean; toggle: () => void }) {
  const label = expanded ? 'Restore size' : 'Expand';
  // Hover only: a dialog with no field focuses this button as it opens, and a tooltip opened by that focus would take
  // the first Escape. The shortcut still reaches assistive tech through aria-keyshortcuts.
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

// --- side panel ---------------------------------------------------------------------------------------------------

const SMALL_HEADING = 'm-0 text-[11px] font-medium uppercase tracking-wider text-base-500';

function PanelSection({ heading, htmlFor, children }: { heading: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      {htmlFor ? <label htmlFor={htmlFor} className={SMALL_HEADING}>{heading}</label> : <h3 className={SMALL_HEADING}>{heading}</h3>}
      {children}
    </div>
  );
}

function toggle(draft: Draft, label: string, set: (d: Draft) => void) {
  set({ ...draft, labels: draft.labels.includes(label) ? draft.labels.filter((l) => l !== label) : [...draft.labels, label] });
}

/** Toggle chips, one group per prefix under a small heading, the unprefixed labels last under "Other". */
function LabelChips({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  const groups = groupLabels(repoOf(draft).labels);
  return (
    <div className="grid gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="m-0 text-xs font-medium text-base-content">Labels</h3>
        {draft.labels.length > 0 && <button type="button" className="rounded-sm text-xs text-base-500 outline-none hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary" onClick={() => set({ ...draft, labels: [] })}>Clear</button>}
      </div>
      {groups.map(({ prefix, options }) => (
        <div key={prefix || '-'} role="group" aria-label={prefix || 'Other labels'} className="grid gap-1.5">
          {groups.length > 1 && <span className={SMALL_HEADING}>{prefix || 'Other'}</span>}
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => {
              const on = draft.labels.includes(o.label);
              return (
                <button key={o.label} type="button" aria-pressed={on} onClick={() => toggle(draft, o.label, set)}
                  className={`inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-primary/60 bg-primary/8 text-primary' : 'border-base-300 bg-base-100 text-base-700 hover:border-base-400 hover:text-base-content'}`}>
                  {on && <Check className="-ms-0.5 size-3" />}{o.text}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SidePanel({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  const repo = repoOf(draft);
  return (
    <aside aria-label="Details" className="grid content-start gap-5 overflow-y-auto border-l border-base-300 bg-base-50/60 px-4 py-4">
      <PanelSection heading="Repository" htmlFor="p-repo">
        <NativeSelect id="p-repo" value={draft.repo} onChange={(e) => set({ ...draft, repo: e.currentTarget.value, labels: [] })}>
          {REPOS.map((r) => <option key={r.repo} value={r.repo}>{r.name}</option>)}
        </NativeSelect>
        {repo.azure && (
          <div className="grid gap-1 pt-1">
            <Checkbox label={`Only for ${repo.name}`} checked={draft.onlyFor} onChange={() => set({ ...draft, onlyFor: !draft.onlyFor })} />
            <p className="m-0 ps-6 text-xs leading-snug text-base-500">Unticked, it shows for every repository reading the {repo.azure.team} team's backlog and sprint.</p>
          </div>
        )}
      </PanelSection>
      <PanelSection heading="Kind" htmlFor="p-kind">
        <NativeSelect id="p-kind" value={draft.kind} onChange={(e) => set({ ...draft, kind: e.currentTarget.value })}>
          <option value="">None</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </NativeSelect>
      </PanelSection>
      <div className="h-px bg-base-300/70" />
      <LabelChips draft={draft} set={set} />
    </aside>
  );
}

// --- add item -----------------------------------------------------------------------------------------------------

function AddItemModal({ draft, set, onClose }: { draft: Draft; set: (d: Draft) => void; onClose: () => void }) {
  const [expanded, toggleExpanded] = useExpand();
  const [tried, setTried] = useState(false);
  const add = () => (draft.title.trim() ? onClose() : setTried(true));
  return (
    <Modal onClose={onClose}>
      <Modal.Content title="Add item" presentation="paned" style={expanded ? EXPANDED : undefined}
        description={`A new issue in ${repoOf(draft).name}, added to List.`}
        headerActions={<ExpandButton expanded={expanded} toggle={toggleExpanded} />}>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_16rem] border-t border-base-300">
          <div className="flex min-h-0 flex-col gap-3 px-5 pb-5 pt-4 sm:px-6">
            <div className="grid gap-1">
              <input aria-label="Title" aria-required aria-invalid={tried && !draft.title.trim()} placeholder="Title" autoComplete="off" value={draft.title}
                onChange={(e) => set({ ...draft, title: e.currentTarget.value })}
                className="w-full border-0 bg-transparent p-0 text-xl font-semibold tracking-tight text-base-content outline-none placeholder:font-medium placeholder:text-base-400" />
              {tried && !draft.title.trim() && <p className="m-0 text-xs text-(--error-foreground)" role="alert">Give it a title.</p>}
            </div>
            <LiveEditor label="Description" placeholder="Add a description… - for a list, 1. for steps, # for a heading" value={draft.description} onChange={(description) => set({ ...draft, description })} fill />
          </div>
          <SidePanel draft={draft} set={set} />
        </div>
        <Modal.Footer leading={<span className="text-xs text-base-500">Formats as you type · saved as Markdown</span>}>
          <Button {...kind('other')} type="button" onClick={onClose}>Cancel</Button>
          <Button {...kind('main')} type="button" onClick={add}>Add to List</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}

// --- item dialog --------------------------------------------------------------------------------------------------

function ItemDialogMock({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState(ITEM.description);
  const [editing, setEditing] = useState<string | null>(null);
  // The saved text as the editor writes it back, so opening Edit isn't already a change.
  const [baseline, setBaseline] = useState(ITEM.description);
  const dirty = editing !== null && editing !== baseline && editing !== saved;
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [expanded, toggleExpanded] = useExpand(asking);
  // Escape, a click outside or Close with unsaved changes asks first.
  const close = () => (dirty ? setAsking(true) : onClose());
  const fill = expanded && editing !== null;
  return (
    <>
    <Modal onClose={close}>
      <Modal.Content title={`${ITEM.ref} ${ITEM.title}`} presentation="workspace" style={expanded ? EXPANDED : undefined}
        headerActions={<ExpandButton expanded={expanded} toggle={toggleExpanded} />}>
        <div className="shrink-0 border-b border-base-300 px-5 pb-3 text-xs text-base-700 sm:px-6">lar · <span className="font-medium text-base-content">List</span> · updated 2h ago</div>
        <Modal.Body layout={fill ? 'fill' : 'scroll'}>
          <div className={`grid gap-6 pt-3 ${expanded ? '' : 'max-w-3xl'} ${fill ? 'min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto]' : ''}`}>
            <div className="flex flex-wrap items-center gap-1.5">{ITEM.labels.map((l) => <Badge key={l}>{l}</Badge>)}</div>
            <section className={`grid gap-2 ${fill ? 'min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]' : ''}`} aria-labelledby="p-desc">
              <div className="flex h-7 items-center justify-between gap-2">
                <h2 id="p-desc" className={SMALL_HEADING}>Description</h2>
                {editing === null && <Button {...kind('other')} leftIcon={<Pencil />} onClick={() => { setEditing(saved); setNote(''); }}>Edit</Button>}
              </div>
              {editing === null
                ? <>{saved ? <RichText text={saved} format="markdown" /> : <p className="m-0 text-sm text-base-500">No description.</p>}
                    {note && <p className="m-0 text-xs text-success" role="status">{note}</p>}</>
                : <>
                    <div className={fill ? 'flex min-h-0 flex-col' : 'contents'}>
                      <LiveEditor label="Description" placeholder="Add a description…" autoFocus onBaseline={setBaseline} value={editing} onChange={setEditing} fill={fill} />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <span className="me-auto text-xs text-base-500">{dirty ? 'Unsaved changes' : 'No changes'}</span>
                      <Button {...kind('other')} onClick={() => setEditing(null)}>Cancel</Button>
                      <Button {...kind('main')} disabled={!dirty} onClick={() => { setSaved(editing); setEditing(null); setNote('Saved (prototype: nothing was written to GitHub).'); }}>Save</Button>
                    </div>
                  </>}
            </section>
            <section className="grid gap-2" aria-labelledby="p-comments">
              <h2 id="p-comments" className={SMALL_HEADING}>Comments · 1</h2>
              <div className="rounded-lg border border-base-300 px-3 py-2 text-sm">Repro on iOS 26 only.</div>
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
            <Button {...kind('main', 'danger')} onClick={() => { setAsking(false); onClose(); }}>Discard</Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal>
    )}
    </>
  );
}

// --- page and state -----------------------------------------------------------------------------------------------

function Page() {
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.search).get('open') ?? 'add');
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, title: 'Show lyrics while playing', labels: ['app: music'], description: '- Lyrics under the artwork\n- Scroll with the song' });
  const show = (o: string | null) => {
    setOpen(o);
    const p = new URLSearchParams(location.search);
    if (o) p.set('open', o); else p.delete('open');
    history.replaceState(null, '', `?${p}`);
  };
  return (
    <TooltipProvider>
      <div className="grid gap-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="mr-2">PROTOTYPE #496</strong>
          <Button {...kind('main')} onClick={() => show('add')}>Add item</Button>
          <Button {...kind('other')} onClick={() => show('item')}>Open {ITEM.ref} {ITEM.title}</Button>
          <Button {...kind('other')} onClick={() => setDraft(EMPTY)}>Clear draft</Button>
        </div>
        <p className="m-0 max-w-3xl text-sm text-base-500">Throwaway, mock data, nothing is written. {SHORTCUT} or the header's expand button grows a dialog. ?open=add|item, or the toggle below.</p>
      </div>
      {/* Add item's draft, above the modal's overlay. */}
      {open === 'add' && <pre className="pointer-events-none fixed bottom-3 left-3 z-[2147483647] m-0 max-h-[30vh] w-72 overflow-hidden whitespace-pre-wrap rounded-md bg-black/85 p-3 font-mono text-[11px] text-white shadow-xl">
        {JSON.stringify(draft, null, 1)}
      </pre>}
      {open === 'add' && <AddItemModal draft={draft} set={setDraft} onClose={() => show(null)} />}
      {open === 'item' && <ItemDialogMock onClose={() => show(null)} />}
      {/* data-slot="toaster" makes the design system's Modal ignore clicks on it rather than close. */}
      <div data-slot="toaster" role="group" aria-label="Prototype dialog" className="pointer-events-auto fixed bottom-4 left-1/2 z-[2147483647] flex -translate-x-1/2 gap-1 rounded-full bg-black p-1 text-xs text-white shadow-xl">
        {(['add', 'item'] as const).map((o) => (
          <button key={o} type="button" aria-pressed={open === o} onClick={() => show(o)} className={`rounded-full px-3 py-1 ${open === o ? 'bg-white text-black' : 'hover:bg-white/20'}`}>
            {o === 'add' ? 'Add item' : 'Item dialog'}
          </button>
        ))}
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById('app')!).render(<StrictMode><Page /></StrictMode>);
