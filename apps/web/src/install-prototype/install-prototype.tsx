// PROTOTYPE #597, throwaway: what the User sees while lar's skills install, and Settings > Skills with T3's provider
// instances and manual ticks. Three variants on the board's own page, all on fake data:
//   ?proto=597&screen=overview|settings&variant=a|b|c&state=<STATES key>
// A: a modal matrix, skills × install targets; Settings lists instances in a table.
// B: a tray in the corner that never blocks the board, one bar per target; Settings lists install folders, ticks inline.
// C: a full-screen Release note; Settings keeps T3's own rows, one per provider instance.
// The floating bar switches screen, variant (← →) and state (↑ ↓). Nothing here writes anything.

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleDashed, Clock, FolderPlus, LoaderCircle, PenLine, RefreshCw, Trash2, X } from 'lucide-react';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Progress } from '@lar-factory/ui/progress';
import { kind } from '../buttons/button-kinds.tsx';
import { Switch, ToolState } from '../settings/controls.tsx';
import { useSettingsStore } from '../settings/settings-store.ts';

// ---------- fake data ----------

/** lar's own skills in the Release; the names are placeholders until #595 settles the module layout. */
const SKILLS = ['lar-work', 'lar-shape', 'lar-build', 'lar-review', 'lar-research', 'lar-prototype'] as const;
type Skill = (typeof SKILLS)[number];

interface Target { id: string; path: string; readers: string; ticked?: boolean }
const TARGETS: Target[] = [
  { id: 'agents', path: '~/.agents/skills', readers: 'Codex, Cursor, Grok, OpenCode, fx, Muse, Pi' },
  { id: 'vi', path: '~/.claude/skills', readers: 'Claude "VI"' },
  { id: 'personal', path: '~/Profiles/claude-personal/skills', readers: 'Claude "Personal"' },
  { id: 'ag-config', path: '~/.gemini/config/skills', readers: 'Antigravity' },
  { id: 'ag-cli', path: '~/.gemini/antigravity-cli/skills', readers: 'Antigravity' },
  { id: 'ticked', path: '~/Work/shared-agents/skills', readers: 'Ticked by you', ticked: true },
];
/** Folders the User could tick; the first is ticked (it's the `ticked` target above). */
const EXTRA_FOLDERS = [
  { path: '~/Work/shared-agents/skills', on: true },
  { path: '~/.claude-old/skills', on: false },
];

interface Instance { name: string; id: string; driver: string; enabled: boolean; home?: string; targets: string[] }
const INSTANCES: Instance[] = [
  { name: 'VI', id: 'claudeAgent', driver: 'Claude', enabled: true, home: '~/.claude (default)', targets: ['vi'] },
  { name: 'Personal', id: 'claudeAgent_personal', driver: 'Claude', enabled: true, home: '~/Profiles/claude-personal', targets: ['personal'] },
  { name: 'Codex', id: 'codex', driver: 'Codex', enabled: true, targets: ['agents'] },
  { name: 'Cursor', id: 'cursor', driver: 'Cursor', enabled: false, targets: ['agents'] },
  { name: 'Grok', id: 'grok', driver: 'Grok', enabled: false, targets: ['agents'] },
  { name: 'OpenCode', id: 'opencode', driver: 'OpenCode', enabled: false, targets: ['agents'] },
  { name: 'Antigravity', id: 'antigravity', driver: 'Antigravity', enabled: false, targets: ['ag-config', 'ag-cli'] },
  { name: 'fx', id: 'fx', driver: 'fx', enabled: false, targets: ['agents'] },
  { name: 'Muse', id: 'muse', driver: 'Muse', enabled: false, targets: ['agents'] },
  { name: 'Pi', id: 'pi', driver: 'Pi', enabled: false, targets: ['agents'] },
];
/** What T3 knows without its server: only the default Claude home and the shared folder. */
const KNOWN_WITHOUT_T3 = new Set(['agents', 'vi']);

type Cell = 'done' | 'writing' | 'queued' | 'waiting' | 'error' | 'replaced' | 'drift' | 'clash';

export const STATES = {
  installing: 'Installing',
  done: 'Done',
  error: 'Error in one target',
  drift: 'Drift found (no new Release)',
  overwrote: 'New Release overwrote Drift',
  clash: 'Clash left untouched',
  cleanup: 'Old Copies removed',
  t3down: "T3 isn't answering",
} as const;
export type State = keyof typeof STATES;

interface Scenario {
  release: string;
  /** The Release the manifest last installed; null on first launch. */
  previous: string | null;
  /** True for the launch check, which installs nothing. */
  checkOnly?: boolean;
  cells: Record<string, Record<Skill, Cell>>;
  error?: { target: string; message: string };
  drift?: { target: string; skill: Skill; how: 'edited' | 'deleted' }[];
  replaced?: { target: string; skill: Skill; how: 'edited' | 'deleted' }[];
  clash?: { target: string; skill: Skill };
  removed?: { target: string; skills: string[] }[];
  untouched?: { target: string; skill: string }[];
  t3Down?: boolean;
}

const all = (cell: Cell) => Object.fromEntries(SKILLS.map((s) => [s, cell])) as Record<Skill, Cell>;
const grid = (fn: (t: Target, s: Skill, i: number) => Cell) => {
  let i = 0;
  return Object.fromEntries(TARGETS.map((t) => [t.id, Object.fromEntries(SKILLS.map((s) => [s, fn(t, s, i++)]))])) as Scenario['cells'];
};
const DRIFT = [{ target: 'vi', skill: 'lar-review', how: 'edited' }, { target: 'agents', skill: 'lar-work', how: 'deleted' }] as const;
const OLD_COPIES = ['tdd', 'grilling', 'prototype', 'research', 'diagnosing-bugs', 'domain-modeling', 'pr', 'implement', 'to-tickets', 'handoff', 'retro', 'unslop', 'writing-for-agents', 'codebase-design'];

export function scenario(state: State, tick: number): Scenario {
  const base = { release: '0.43.0', previous: '0.42.0' };
  switch (state) {
    case 'installing': {
      const total = TARGETS.length * SKILLS.length;
      const at = tick % (total + 6);
      return { ...base, cells: grid((_t, _s, i) => (i < at ? 'done' : i === at ? 'writing' : 'queued')) };
    }
    case 'done': return { ...base, cells: grid(() => 'done') };
    case 'error': return { ...base, cells: { ...grid(() => 'done'), 'ag-cli': all('error') },
      error: { target: 'ag-cli', message: "EACCES: permission denied, mkdir '~/.gemini/antigravity-cli/skills'" } };
    case 'drift': return { release: '0.42.0', previous: '0.42.0', checkOnly: true, drift: [...DRIFT],
      cells: grid((t, s) => (DRIFT.some((d) => d.target === t.id && d.skill === s) ? 'drift' : 'done')) };
    case 'overwrote': return { ...base, replaced: [...DRIFT],
      cells: grid((t, s) => (DRIFT.some((d) => d.target === t.id && d.skill === s) ? 'replaced' : 'done')) };
    case 'clash': return { ...base, clash: { target: 'agents', skill: 'lar-review' },
      cells: grid((t, s) => (t.id === 'agents' && s === 'lar-review' ? 'clash' : 'done')) };
    case 'cleanup': return { release: '0.40.0', previous: '0.39.2', cells: grid(() => 'done'),
      removed: [{ target: 'agents', skills: OLD_COPIES }, { target: 'vi', skills: OLD_COPIES }],
      untouched: [{ target: 'personal', skill: 'tdd' }, { target: 'personal', skill: 'grilling' }] };
    case 't3down': return { ...base, t3Down: true, cells: grid((t) => (KNOWN_WITHOUT_T3.has(t.id) ? 'done' : 'waiting')) };
  }
}

const pathOf = (id: string) => TARGETS.find((t) => t.id === id)!.path;
const count = (sc: Scenario, cells: Cell[]) => Object.values(sc.cells).flatMap((row) => Object.values(row)).filter((c) => cells.includes(c)).length;
const targetCount = (sc: Scenario, id: string) => Object.values(sc.cells[id]!).filter((c) => c === 'done' || c === 'replaced').length;
const isComplete = (sc: Scenario) => !Object.values(sc.cells).some((row) => Object.values(row).some((c) => c === 'writing' || c === 'queued'));
/** A target's state for Settings: whether it has the current Release. */
function targetState(sc: Scenario, id: string): { text: string; tone: 'success' | 'warning' | 'error' | 'muted' } {
  const cells = Object.values(sc.cells[id]!);
  if (cells.includes('error')) return { text: "Couldn't install", tone: 'error' };
  if (cells.includes('clash')) return { text: 'Clash', tone: 'error' };
  if (cells.includes('drift')) return { text: 'Drift', tone: 'warning' };
  if (cells.includes('waiting')) return { text: 'Waiting for T3 Code', tone: 'muted' };
  if (cells.some((c) => c === 'writing' || c === 'queued')) return { text: 'Installing', tone: 'muted' };
  return { text: `Release ${sc.release}`, tone: 'success' };
}

// ---------- the prototype's state, in the URL ----------

type Screen = 'overview' | 'settings';
type Variant = 'a' | 'b' | 'c';
const VARIANTS: Record<Variant, string> = { a: 'Matrix modal', b: 'Corner tray, folders', c: 'Release note, T3 rows' };
const params = () => new URLSearchParams(location.search);
export const prototypeOn = () => params().get('proto') === '597';

interface Proto { screen: Screen; variant: Variant; state: State; tick: number; dismissed: boolean; set: (p: Partial<Proto>) => void }
export const useProto = create<Proto>()((set) => ({
  screen: (params().get('screen') as Screen) || 'overview',
  variant: (params().get('variant') as Variant) || 'a',
  state: (params().get('state') as State) || 'installing',
  tick: 0,
  dismissed: false,
  set: (p) => {
    set({ ...p, dismissed: false });
    const url = new URL(location.href);
    for (const k of ['screen', 'variant', 'state'] as const) if (p[k]) url.searchParams.set(k, p[k]);
    history.replaceState(null, '', url);
  },
}));
const useScenario = () => { const { state, tick } = useProto(); return scenario(state, tick); };

// ---------- shared bits ----------

function CellIcon({ cell }: { cell: Cell }) {
  const map: Record<Cell, [ReactNode, string, string]> = {
    done: [<Check />, 'text-(--success-foreground)', 'Installed'],
    writing: [<LoaderCircle className="animate-spin" />, 'text-(--foreground)', 'Writing'],
    queued: [<CircleDashed />, 'text-(--muted-foreground) opacity-50', 'Queued'],
    waiting: [<Clock />, 'text-(--muted-foreground)', 'Waits for T3 Code'],
    error: [<X />, 'text-(--destructive-foreground)', "Couldn't write"],
    replaced: [<RefreshCw />, 'text-(--warning-foreground)', 'Drift replaced'],
    drift: [<PenLine />, 'text-(--warning-foreground)', 'Drift'],
    clash: [<Ban />, 'text-(--destructive-foreground)', 'Clash: left untouched'],
  };
  const [icon, color, title] = map[cell];
  return <span title={title} className={`inline-grid size-5 place-items-center [&_svg]:size-3.5 ${color}`}>{icon}</span>;
}
const Code = ({ children }: { children: ReactNode }) => <code className="break-all rounded bg-(--muted) px-1 text-[11px]">{children}</code>;

/** The notices every variant shows, as design-system Alerts. */
function Notices({ sc, compact = false }: { sc: Scenario; compact?: boolean }) {
  return <>
    {sc.t3Down && <Alert compact={compact} tone="info" title="T3 Code isn't answering">
      Installed into <Code>~/.agents/skills</Code> and <Code>~/.claude/skills</Code>. The other provider instances get Release {sc.release} once T3 Code answers.
    </Alert>}
    {sc.error && <Alert compact={compact} tone="danger" title={`Couldn't write ${pathOf(sc.error.target)}`}>
      <span className="block">{sc.error.message}</span>
      <span className="block">Antigravity runs without lar's skills until this folder installs. <Button {...kind('other')} className="ml-1">Try again</Button></span>
    </Alert>}
    {sc.drift && <Alert compact={compact} tone="warning" title={`${sc.drift.length} lar skills differ from Release ${sc.release}`}>
      <span className="block">{sc.drift.map((d, i) => <span key={i}>{i ? ', ' : ''}<b>{d.skill}</b> in <Code>{pathOf(d.target)}</Code> ({d.how})</span>)}.</span>
      <span className="mt-1 flex items-center gap-2"><Button {...kind('other')}>Replace</Button><span className="text-xs text-(--muted-foreground)">Start build asks: Replace and start, or Start anyway.</span></span>
    </Alert>}
    {sc.replaced && <Alert compact={compact} tone="info" title={`Release ${sc.release} replaced ${sc.replaced.length} lar skills that had Drift`}>
      {sc.replaced.map((d, i) => <span key={i}>{i ? ', ' : ''}<b>{d.skill}</b> in <Code>{pathOf(d.target)}</Code> ({d.how})</span>)}.
    </Alert>}
    {sc.clash && <Alert compact={compact} tone="danger" title={`Clash: ${pathOf(sc.clash.target)}/${sc.clash.skill}`}>
      A folder named like lar's <b>{sc.clash.skill}</b> that lar didn't install. Lar left it untouched, so Codex, Cursor and the rest read it instead of lar's.
      Start build stays off until you rename or remove it.
    </Alert>}
    {sc.removed && <Alert compact={compact} tone="info" title={`Removed ${sc.removed[0]!.skills.length} old Copies from ${sc.removed.length} folders`}>
      <span className="block">Earlier Releases installed these; Release {sc.release} folds them into lar's skills: {sc.removed[0]!.skills.join(', ')}.</span>
      <span className="block">From {sc.removed.map((r, i) => <span key={r.target}>{i ? ' and ' : ''}<Code>{pathOf(r.target)}</Code></span>)}.
        {sc.untouched && <> Left alone, as lar never installed them: {sc.untouched.map((u, i) => <span key={i}>{i ? ', ' : ''}<Code>{pathOf(u.target)}/{u.skill}</Code></span>)}.</>}</span>
    </Alert>}
  </>;
}

function heading(sc: Scenario): { title: string; description: string } {
  if (sc.checkOnly) return { title: `Skills differ from Release ${sc.release}`, description: 'Found at launch. Lar replaces nothing without you.' };
  const done = isComplete(sc);
  const from = sc.previous ? `Replacing Release ${sc.previous}` : 'First launch';
  if (sc.t3Down) return { title: `Release ${sc.release} is in 2 of ${TARGETS.length} folders`, description: 'The rest waits for T3 Code to list its provider instances.' };
  return { title: done ? `Release ${sc.release}'s skills are installed` : `Installing Release ${sc.release}'s skills`, description: `${from} · ${SKILLS.length} skills into ${TARGETS.length} folders` };
}
const StartBuild = ({ sc }: { sc: Scenario }) => sc.clash
  ? <Button {...kind('start')} disabled title="Rename or remove the Clash first">Start build</Button> : null;

// ---------- variant A: modal matrix ----------

function OverviewA() {
  const sc = useScenario();
  const { title, description } = heading(sc);
  const done = count(sc, ['done', 'replaced']);
  const close = () => useProto.setState({ dismissed: true });
  return (
    <Modal onClose={close}>
      <Modal.Content title={title} description={description}>
        <Modal.Body>
          <div className="grid gap-4">
            {!sc.checkOnly && <Progress value={done} max={TARGETS.length * SKILLS.length} caption={`${done} of ${TARGETS.length * SKILLS.length}`} />}
            <Notices sc={sc} compact />
            <div className="overflow-x-auto rounded-xl border border-(--border)">
              <table className="w-full border-collapse text-xs">
                <thead><tr className="bg-(--muted) text-(--muted-foreground)">
                  <th className="px-3 py-2 text-left font-medium">Folder · read by</th>
                  {SKILLS.map((s) => <th key={s} className="px-1 py-2 font-medium"><span className="inline-block -rotate-30 whitespace-nowrap">{s}</span></th>)}
                </tr></thead>
                <tbody>{TARGETS.map((t) => (
                  <tr key={t.id} className="border-t border-(--border)">
                    <td className="px-3 py-2"><div className="font-mono text-[11px]">{t.path}</div><div className="text-(--muted-foreground)">{t.readers}</div></td>
                    {SKILLS.map((s) => <td key={s} className="text-center"><CellIcon cell={sc.cells[t.id]![s]} /></td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer leading={<StartBuild sc={sc} />}>
          <Button {...kind('main')} onClick={close}>{isComplete(sc) ? 'Done' : 'Hide'}</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}

function SettingsA() {
  const sc = useScenario();
  const [extra, setExtra] = useState(EXTRA_FOLDERS);
  return (
    <div className="grid gap-5">
      <Notices sc={sc} compact />
      <section className="grid gap-2">
        <h3 className="m-0 text-[13px] font-semibold">Provider instances</h3>
        <p className="m-0 text-xs text-(--muted-foreground)">Every instance T3 Code lists, enabled or not. Each gets Release {sc.release} in the folder it reads.</p>
        <div className="overflow-x-auto rounded-xl border border-(--border) bg-(--card)">
          <table className="w-full border-collapse text-xs">
            <thead><tr className="bg-(--muted) text-left text-(--muted-foreground)">
              {['Instance', 'Folder', 'Release', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>{INSTANCES.filter((i) => !sc.t3Down || i.targets.every((t) => KNOWN_WITHOUT_T3.has(t))).map((i) => {
              const st = targetState(sc, i.targets.find((t) => targetState(sc, t).tone !== 'success') ?? i.targets[0]!);
              return (
                <tr key={i.id} className="border-t border-(--border)">
                  <td className="px-3 py-2"><div className="text-[13px] font-medium">{i.driver === i.name ? i.name : `${i.driver} "${i.name}"`}</div>
                    <div className="text-(--muted-foreground)">{i.id}{!i.enabled && ' · disabled in T3 Code'}</div></td>
                  <td className="px-3 py-2 font-mono text-[11px]">{i.targets.map((t) => <div key={t}>{pathOf(t)}</div>)}</td>
                  <td className="px-3 py-2"><ToolState {...st} /></td>
                  <td className="px-3 py-2 text-right">{st.tone !== 'success' && <Button {...kind('other')}>Install</Button>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        {sc.t3Down && <p className="m-0 text-xs text-(--muted-foreground)">T3 Code isn't answering, so only the instances lar knows without it show. The rest appear when it answers.</p>}
      </section>
      <section className="grid gap-2">
        <h3 className="m-0 text-[13px] font-semibold">Extra folders</h3>
        <p className="m-0 text-xs text-(--muted-foreground)">Ticked folders get every Release too. Unticking removes lar's skills from the folder.</p>
        <div className="grid gap-2 rounded-xl border border-(--border) bg-(--card) p-3">
          {extra.map((f, n) => <label key={f.path} className="flex items-center gap-2 text-xs">
            <Checkbox checked={f.on} onChange={() => setExtra(extra.map((e, m) => (m === n ? { ...e, on: !e.on } : e)))} />
            <span className="font-mono">{f.path}</span>
            {f.on && <span className="ml-auto"><ToolState {...targetState(sc, 'ticked')} /></span>}
          </label>)}
          <div><Button {...kind('other')}><FolderPlus className="size-3.5" />Add folder…</Button></div>
        </div>
      </section>
    </div>
  );
}

// ---------- variant B: corner tray, folders ----------

function OverviewB() {
  const sc = useScenario();
  const { title, description } = heading(sc);
  const [open, setOpen] = useState<string | null>(null);
  const [small, setSmall] = useState(false);
  const done = count(sc, ['done', 'replaced']);
  const total = TARGETS.length * SKILLS.length;
  const problems = [sc.error, sc.drift, sc.clash].some(Boolean);
  return (
    <aside style={{ position: 'fixed', right: 16, bottom: 64, zIndex: 40 }} className="w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-(--border) bg-(--card) shadow-xl">
      <header className="flex items-start gap-2 border-b border-(--border) px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="text-xs text-(--muted-foreground)">{description}</div>
          {!sc.checkOnly && <Progress className="mt-2" value={done} max={total} caption={`${done}/${total}`} />}
        </div>
        <button type="button" aria-label={small ? 'Expand' : 'Collapse'} className="grid size-6 place-items-center rounded hover:bg-(--muted)" onClick={() => setSmall(!small)}>
          {small ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
        {isComplete(sc) && !problems && <button type="button" aria-label="Close" className="grid size-6 place-items-center rounded hover:bg-(--muted)" onClick={() => useProto.setState({ dismissed: true })}><X className="size-4" /></button>}
      </header>
      {!small && <div className="grid max-h-[60vh] gap-3 overflow-y-auto p-3">
        <Notices sc={sc} compact />
        <ul className="m-0 grid list-none gap-1 p-0">
          {TARGETS.map((t) => {
            const cells = sc.cells[t.id]!;
            const n = targetCount(sc, t.id);
            const st = targetState(sc, t.id);
            return <li key={t.id} className="rounded-lg hover:bg-(--muted)">
              <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[11px]">{t.path}</div>
                  <div className="truncate text-[11px] text-(--muted-foreground)">{t.readers}</div>
                </div>
                {st.tone === 'success' || st.text === 'Installing' ? <span className="w-20"><Progress value={n} max={SKILLS.length} /></span> : <ToolState {...st} />}
                <ChevronRight className={`size-3.5 transition ${open === t.id ? 'rotate-90' : ''}`} />
              </button>
              {open === t.id && <div className="grid grid-cols-2 gap-x-3 px-3 pb-2">
                {SKILLS.map((s) => <div key={s} className="flex items-center gap-1 text-[11px]"><CellIcon cell={cells[s]} />{s}</div>)}
              </div>}
            </li>;
          })}
        </ul>
        {sc.clash && <div className="flex justify-end"><StartBuild sc={sc} /></div>}
      </div>}
    </aside>
  );
}

function SettingsB() {
  const sc = useScenario();
  const [extra, setExtra] = useState(EXTRA_FOLDERS);
  const folders = TARGETS.filter((t) => !t.ticked);
  return (
    <div className="grid gap-5">
      <Notices sc={sc} compact />
      <section className="grid gap-2">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <h3 className="m-0 text-[13px] font-semibold">Install folders</h3>
            <p className="m-0 text-xs text-(--muted-foreground)">Lar installs Release {sc.release} into each folder an agent reads. T3 Code's provider instances decide most of them; tick others to add them.</p>
          </div>
          <Button {...kind('other')}>Install everywhere</Button>
        </div>
        <div className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--card)">
          {folders.map((t) => {
            const readers = INSTANCES.filter((i) => i.targets.includes(t.id));
            const known = !sc.t3Down || KNOWN_WITHOUT_T3.has(t.id);
            const st = targetState(sc, t.id);
            return <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <Checkbox checked disabled title="T3 Code lists an instance that reads this folder" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs">{t.path}</div>
                <div className="mt-1 flex flex-wrap gap-1">{known
                  ? readers.map((i) => <Badge key={i.id} tone={i.enabled ? 'accent' : 'neutral'} title={i.enabled ? 'Enabled' : 'Disabled in T3 Code; still gets skills'}>{i.driver === i.name ? i.name : `${i.driver} "${i.name}"`}</Badge>)
                  : <span className="text-[11px] text-(--muted-foreground)">Known once T3 Code answers</span>}</div>
              </div>
              <ToolState {...st} />
              {st.tone !== 'success' && st.text !== 'Waiting for T3 Code' && <Button {...kind('other')}>{st.text === 'Drift' ? 'Replace' : 'Install'}</Button>}
            </div>;
          })}
          {extra.map((f, n) => <div key={f.path} className="flex items-center gap-3 px-4 py-3">
            <Checkbox checked={f.on} onChange={() => setExtra(extra.map((e, m) => (m === n ? { ...e, on: !e.on } : e)))} aria-label={`Install into ${f.path}`} />
            <div className="min-w-0 flex-1"><div className="font-mono text-xs">{f.path}</div><div className="text-[11px] text-(--muted-foreground)">Added by you</div></div>
            {f.on ? <ToolState {...targetState(sc, 'ticked')} /> : <span className="text-xs text-(--muted-foreground)">Not installed</span>}
          </div>)}
          <div className="bg-(--muted) px-4 py-2"><Button {...kind('other')}><FolderPlus className="size-3.5" />Add folder…</Button></div>
        </div>
      </section>
    </div>
  );
}

// ---------- variant C: full-screen Release note, T3 rows ----------

function OverviewC() {
  const sc = useScenario();
  const { title, description } = heading(sc);
  const done = count(sc, ['done', 'replaced']);
  const total = TARGETS.length * SKILLS.length;
  const close = () => useProto.setState({ dismissed: true });
  // The launch check isn't an install: C shows it as a slim bar over the board, not the full screen.
  if (sc.checkOnly) return (
    <div className="fixed inset-x-0 top-12 z-40 mx-auto w-[min(48rem,calc(100vw-2rem))] rounded-xl bg-(--background) shadow-lg"><Notices sc={sc} /></div>
  );
  return (
    <div className="fixed inset-0 z-40 grid grid-cols-[minmax(16rem,22rem)_1fr] bg-(--background)">
      <div className="flex flex-col gap-4 border-r border-(--border) p-8 pt-14">
        <div className="text-xs font-medium tracking-wide text-(--muted-foreground) uppercase">{sc.previous ? `${sc.previous} → ${sc.release}` : `Welcome to Lar Factory ${sc.release}`}</div>
        <h1 className="m-0 text-2xl font-semibold">{title}</h1>
        <p className="m-0 text-sm text-(--muted-foreground)">{description}</p>
        <Progress value={done} max={total} caption={`${done} of ${total}`} />
        <dl className="m-0 grid grid-cols-2 gap-2 text-xs">
          {([['Installed', ['done']], ['Replaced', ['replaced']], ['Waiting', ['waiting', 'queued', 'writing']], ['Failed', ['error', 'clash']]] as [string, Cell[]][]).map(([label, cells]) =>
            <div key={label} className="rounded-lg border border-(--border) p-2"><dt className="text-(--muted-foreground)">{label}</dt><dd className="m-0 text-lg font-semibold">{count(sc, cells)}</dd></div>)}
        </dl>
        <div className="mt-auto flex gap-2"><StartBuild sc={sc} /><Button {...kind('main')} onClick={close} disabled={!isComplete(sc)}>{isComplete(sc) ? 'Open the board' : 'Installing…'}</Button></div>
      </div>
      <div className="overflow-y-auto p-8">
        <div className="mx-auto grid max-w-3xl gap-6">
          <section className="grid gap-2"><Notices sc={sc} /></section>
          <section className="grid gap-1">
            <h2 className="m-0 mb-1 text-[13px] font-semibold">Each skill</h2>
            {SKILLS.map((s) => {
              const cells = TARGETS.map((t) => sc.cells[t.id]![s]);
              const ok = cells.filter((c) => c === 'done' || c === 'replaced').length;
              const bad = TARGETS.filter((t) => ['error', 'clash', 'waiting', 'drift'].includes(sc.cells[t.id]![s]));
              return <div key={s} className="flex items-center gap-3 rounded-lg border border-(--border) px-3 py-2">
                {cells.includes('writing') ? <LoaderCircle className="size-4 animate-spin" /> : ok === TARGETS.length ? <Check className="size-4 text-(--success-foreground)" /> : bad.length ? <AlertTriangle className="size-4 text-(--warning-foreground)" /> : <CircleDashed className="size-4 text-(--muted-foreground)" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{s}</div>
                  <div className="text-xs text-(--muted-foreground)">{ok} of {TARGETS.length} folders{bad.length > 0 && <> · not in {bad.map((t) => t.path).join(', ')}</>}</div>
                </div>
                <div className="flex">{TARGETS.map((t) => <span key={t.id} title={t.path}><CellIcon cell={sc.cells[t.id]![s]} /></span>)}</div>
              </div>;
            })}
          </section>
          {sc.removed && <section className="grid gap-1">
            <h2 className="m-0 text-[13px] font-semibold">Removed</h2>
            {sc.removed.map((r) => <div key={r.target} className="flex items-start gap-2 text-xs"><Trash2 className="mt-0.5 size-3.5 text-(--muted-foreground)" /><span><Code>{pathOf(r.target)}</Code>: {r.skills.join(', ')}</span></div>)}
          </section>}
        </div>
      </div>
    </div>
  );
}

function SettingsC() {
  const sc = useScenario();
  const [extra, setExtra] = useState(EXTRA_FOLDERS);
  const [showOff, setShowOff] = useState(false);
  const shown = INSTANCES.filter((i) => !sc.t3Down || i.targets.every((t) => KNOWN_WITHOUT_T3.has(t)));
  const row = (i: Instance) => {
    const st = targetState(sc, i.targets.find((t) => targetState(sc, t).tone !== 'success') ?? i.targets[0]!);
    return <div key={i.id} className="flex items-center gap-x-6 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{i.driver === i.name ? i.name : `${i.driver} · ${i.name}`}</div>
        <div className="text-xs text-(--muted-foreground)">{i.targets.map(pathOf).join(' and ')}{i.home && i.driver === 'Claude' && ` · home ${i.home}`}</div>
      </div>
      <ToolState {...st} />
      {st.tone !== 'success' && st.text !== 'Waiting for T3 Code' && <Button {...kind('other')}>{st.text === 'Drift' ? 'Replace' : 'Install'}</Button>}
    </div>;
  };
  const box = 'divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--card)';
  return (
    <div className="grid gap-7">
      <section className="grid gap-3">
        <div className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--card) px-4 py-3">
          <div className="flex-1"><div className="text-[13px] font-medium">Release {sc.release}</div>
            <div className="text-xs text-(--muted-foreground)">{SKILLS.join(', ')}</div></div>
          <Button {...kind('other')} onClick={() => useProto.getState().set({ screen: 'overview' })}>Show install overview</Button>
        </div>
        <Notices sc={sc} compact />
      </section>
      <section className="grid gap-3">
        <div><h3 className="m-0 text-[13px] font-semibold">Provider instances</h3>
          <p className="m-0 mt-0.5 text-xs text-(--muted-foreground)">As T3 Code lists them. Each has Release {sc.release} once it shows a green dot.</p></div>
        <div className={box}>{shown.filter((i) => i.enabled).map(row)}</div>
        {sc.t3Down ? <p className="m-0 text-xs text-(--muted-foreground)">T3 Code isn't answering. Its other instances show here, and install, once it answers.</p>
          : <><button type="button" className="flex w-fit items-center gap-1 text-xs text-(--muted-foreground) hover:text-(--foreground)" onClick={() => setShowOff(!showOff)}>
            <ChevronRight className={`size-3.5 ${showOff ? 'rotate-90' : ''}`} />{shown.filter((i) => !i.enabled).length} disabled in T3 Code, still installed</button>
            {showOff && <div className={box}>{shown.filter((i) => !i.enabled).map(row)}</div>}</>}
      </section>
      <section className="grid gap-3">
        <div><h3 className="m-0 text-[13px] font-semibold">Also install into</h3>
          <p className="m-0 mt-0.5 text-xs text-(--muted-foreground)">Folders no provider instance reads. Turning one off removes lar's skills from it.</p></div>
        <div className={box}>
          {extra.map((f, n) => <div key={f.path} className="flex items-center gap-x-6 px-4 py-3">
            <div className="min-w-0 flex-1"><div className="truncate font-mono text-xs">{f.path}</div>
              {f.on && <div className="mt-0.5"><ToolState {...targetState(sc, 'ticked')} /></div>}</div>
            <Switch on={f.on} label={f.path} onChange={() => setExtra(extra.map((e, m) => (m === n ? { ...e, on: !e.on } : e)))} />
          </div>)}
          <div className="bg-(--muted) px-4 py-2"><Button {...kind('other')}><FolderPlus className="size-3.5" />Add folder…</Button></div>
        </div>
      </section>
    </div>
  );
}

// ---------- mounting ----------

const OVERVIEW = { a: OverviewA, b: OverviewB, c: OverviewC };
const SETTINGS = { a: SettingsA, b: SettingsB, c: SettingsC };

/** Settings > Skills' body under the prototype; settings-pages.tsx puts it in place of the profiles and bundled groups. */
export function PrototypeSkillsSettings() {
  const variant = useProto((s) => s.variant);
  const S = SETTINGS[variant];
  return <S />;
}

/** Mounted in App: the overview, Settings opened on Skills, and the floating bar. */
export function InstallPrototype() {
  const { screen, variant, state, dismissed, set } = useProto();
  useEffect(() => {
    const id = setInterval(() => useProto.setState((s) => ({ tick: s.tick + 1 })), 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const settings = useSettingsStore.getState();
    if (screen === 'settings') { settings.setSection('skills'); if (!settings.open) settings.setOpen(true); }
    else if (settings.open) settings.setOpen(false);
  }, [screen]);
  useEffect(() => {
    const keys = Object.keys(STATES) as State[];
    const vs = Object.keys(VARIANTS) as Variant[];
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, [contenteditable]')) return;
      const step = (list: string[], cur: string, d: number) => list[(list.indexOf(cur) + d + list.length) % list.length];
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') set({ variant: step(vs, variant, e.key === 'ArrowLeft' ? -1 : 1) as Variant });
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set({ state: step(keys, state, e.key === 'ArrowUp' ? -1 : 1) as State }); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  const O = OVERVIEW[variant];
  const pill = 'rounded-full px-2 py-0.5 hover:bg-white/15';
  return <>
    {screen === 'overview' && !dismissed && <O />}
    {/* Above the Modal's layer, so it works while Settings or A's modal is open. */}
    {createPortal(<div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647, pointerEvents: 'auto' }} className="flex items-center gap-1 rounded-full bg-neutral-900 px-1.5 py-1 text-xs text-white shadow-lg ring-1 ring-white/10">
      {(['overview', 'settings'] as Screen[]).map((s) => <button key={s} type="button" className={`${pill} ${screen === s ? 'bg-white/20' : ''}`} onClick={() => set({ screen: s })}>{s === 'overview' ? 'Overview' : 'Settings'}</button>)}
      <span className="mx-1 h-4 w-px bg-white/20" />
      <button type="button" aria-label="Previous variant" className="grid size-6 place-items-center rounded-full hover:bg-white/15" onClick={() => set({ variant: ({ a: 'c', b: 'a', c: 'b' } as const)[variant] })}><ChevronLeft className="size-4" /></button>
      <span className="min-w-36 text-center font-medium">{variant.toUpperCase()} · {VARIANTS[variant]}</span>
      <button type="button" aria-label="Next variant" className="grid size-6 place-items-center rounded-full hover:bg-white/15" onClick={() => set({ variant: ({ a: 'b', b: 'c', c: 'a' } as const)[variant] })}><ChevronRight className="size-4" /></button>
      <span className="mx-1 h-4 w-px bg-white/20" />
      <select aria-label="State" value={state} onChange={(e) => set({ state: e.target.value as State })} className="rounded-full bg-neutral-800 px-2 py-0.5 text-white">
        {(Object.keys(STATES) as State[]).map((k) => <option key={k} value={k}>{STATES[k]}</option>)}
      </select>
      {dismissed && screen === 'overview' && <button type="button" className={pill} onClick={() => useProto.setState({ dismissed: false })}>Reopen</button>}
    </div>, document.body)}
  </>;
}
