// PROTOTYPE (#691), throwaway, round 2: three ways a step shows what each choice costs, mounted in the onboarding
// wizard's dialog and switched with ?variant=A1|A2|A3 and ?scenario=1|2|3 from the bar at the top of the dialog. The
// flow is round 1's variant A in all three (what we found, one question per step, asked later); only the control on
// each question step differs. Stub data only; Finish writes nothing.
//   A1: a cost line under each option. A2: "You get" and "You give up" on each option. A3: plain options and one
//   consequence panel for the selected option.

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Clock, Lock, Minus, Plus } from 'lucide-react';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { RadioGroup } from '@lar-factory/ui/design-system/RadioGroup';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { Progress } from '@lar-factory/ui/progress';
import { kind } from '../buttons/button-kinds.tsx';
import { Choice } from './setup-fields.tsx';
import {
  DEFERRED, LOCAL_NOTE, PROTOTYPE_691, SCENARIOS, answerOf, answerText, type Answers, type Question, type Scenario,
} from './prototype-691-scenarios.ts';

const VARIANTS = { A1: 'Cost line', A2: 'Gain and loss', A3: 'Consequence panel' } as const;
type VariantKey = keyof typeof VARIANTS;

// ---- URL params ----------------------------------------------------------------------------------------------------

const subscribe = (fn: () => void) => { addEventListener('popstate', fn); return () => removeEventListener('popstate', fn); };
const useSearch = () => useSyncExternalStore(subscribe, () => location.search);
function setParams(next: Record<string, string>) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(next)) url.searchParams.set(k, v);
  history.replaceState(null, '', url);
  dispatchEvent(new PopStateEvent('popstate'));
}

// ---- Shared pieces (same in every variant) --------------------------------------------------------------------------

function Origin({ q, changed }: { q: Question; changed: boolean }) {
  if (changed) return <Badge tone="accent">Changed</Badge>;
  if (q.fromConfig) return <Badge tone="info">From Repository config</Badge>;
  return <Badge>Detected</Badge>;
}

// ---- A1: cost line --------------------------------------------------------------------------------------------------

/** Each option with its one-line cost, the detected default preselected. */
function CostLineControl({ q, answers, onAnswer }: ControlProps) {
  const value = answerOf(q, answers);
  if (q.kind === 'text') {
    return (
      <div className="grid gap-1.5">
        <Input value={value as string} onChange={(e) => onAnswer(e.target.value)} aria-label={q.short} />
        {q.note && <span className="text-xs text-base-700">{q.note}</span>}
      </div>
    );
  }
  if (q.kind === 'one') {
    return (
      <RadioGroup value={value as string} onValueChange={(v) => onAnswer(v)} className="gap-2">
        {q.options.map((o) => <Choice key={o.id} value={o.id} title={o.title}>{o.cost}</Choice>)}
      </RadioGroup>
    );
  }
  const picked = value as string[];
  if (!q.options.length) return <Text tone="muted">{q.detected}</Text>;
  return (
    <div className="grid gap-2">
      {q.note && <span className="text-xs text-base-700">{q.note}</span>}
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {q.options.map((o) => (
          <li key={o.id}>
            <label className={`flex items-start gap-2.5 rounded-lg border border-base-300 px-3 py-2 ${o.disabled ? 'opacity-60' : 'cursor-pointer'}`}>
              <span className="pt-0.5"><Checkbox checked={!o.disabled && picked.includes(o.id)} disabled={!!o.disabled}
                onChange={() => onAnswer(picked.includes(o.id) ? picked.filter((p) => p !== o.id) : [...picked, o.id])} /></span>
              <span className="grid gap-0.5">
                <span className="flex items-center gap-2 text-sm font-medium">{o.title}{o.disabled && <Badge tone="danger">{o.disabled}</Badge>}</span>
                <span className="text-xs text-base-700">{o.cost}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetectedList({ scenario }: { scenario: Scenario }) {
  return (
    <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {scenario.detected.map((d) => (
        <div key={d.label} className="contents">
          <dt className="text-base-700">{d.label}</dt>
          <dd className={`m-0 ${d.tone === 'warning' ? 'text-(--lar-warning-text)' : ''}`}>{d.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DeferredList() {
  return (
    <div className="grid gap-2">
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {DEFERRED.map((d) => (
          <li key={d.name} className="flex items-start gap-2 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0 text-base-700" />
            <span><span className="font-medium">{d.name}.</span> <span className="text-base-700">{d.when}</span></span>
          </li>
        ))}
      </ul>
      <span className="text-xs text-base-700">{LOCAL_NOTE}</span>
    </div>
  );
}

/** The wizard dialog's chrome: title, help, place and progress, body, footer. */
function Shell({ title, help, place, progress, children, footer }: {
  title: string; help: string; place: string; progress: [number, number]; children: ReactNode; footer: ReactNode;
}) {
  const close = () => setParams({ variant: 'closed' });
  const bar = useContext(BarSlot);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  return (
    <Modal onClose={close}>
      <Modal.Content ref={setContent} data-onboarding-dialog title={title} description={help} focusFirstField={false}>
        {/* Appended to the dialog itself (order-first puts it on top), so it takes its own space and never covers the footer. */}
        {content && createPortal(bar, content)}
        <div className="grid shrink-0 gap-2 px-5 pb-4 sm:px-6">
          <Text tone="muted">{place}</Text>
          <Progress value={progress[0]} max={progress[1]} caption={`${progress[0]} of ${progress[1]}`} aria-label={`${progress[0]} of ${progress[1]}`} />
        </div>
        <Modal.Body><div className="grid gap-5 pb-16">{children}</div></Modal.Body>
        <Modal.Footer>{footer}</Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}

type VariantProps = { scenario: Scenario; answers: Answers; setAnswer: (id: Question['id'], v: string | string[]) => void; finish: () => void };

// The bar, rendered inside each dialog so the modal's focus trap and outside-click dismissal treat it as part of it.
const BarSlot = createContext<ReactNode>(null);

const changedOf = (q: Question, answers: Answers) => answers[q.id] !== undefined && JSON.stringify(answers[q.id]) !== JSON.stringify(q.fallback);

// ---- A2: gain and loss ----------------------------------------------------------------------------------------------

type ControlProps = { q: Question; answers: Answers; onAnswer: (v: string | string[]) => void };

/** One tradeoff line: an icon, a label and what the factory does or can't do. `active` lines apply to the current pick. */
function Line({ icon, label, text, tone, active = true }: { icon: ReactNode; label: string; text: string; tone: 'get' | 'lose' | 'limit'; active?: boolean }) {
  const color = tone === 'get' ? 'text-(--lar-success-text)' : tone === 'limit' ? 'text-(--lar-danger-text)' : 'text-(--lar-warning-text)';
  return (
    <span className={`flex items-start gap-1.5 text-xs ${active ? '' : 'opacity-55'}`}>
      <span className={`mt-px shrink-0 ${color}`}>{icon}</span>
      <span><span className={`font-medium ${active ? color : ''}`}>{label}:</span> <span className="text-base-800">{text}</span></span>
    </span>
  );
}
const get = (text: string, label = 'You get', active?: boolean) => <Line icon={<Plus className="size-3.5" />} label={label} text={text} tone="get" active={active} />;
const lose = (text: string, label = 'You give up', active?: boolean) => <Line icon={<Minus className="size-3.5" />} label={label} text={text} tone="lose" active={active} />;

/** Every option names what you get and what you give up; a tick box says which applies now and which the other state brings. */
function GainLossControl({ q, answers, onAnswer }: ControlProps) {
  const value = answerOf(q, answers);
  if (q.kind === 'text') {
    const o = q.options[0]!;
    return (
      <div className="grid gap-2">
        <Input value={value as string} onChange={(e) => onAnswer(e.target.value)} aria-label={q.short} />
        <span className="grid gap-1">{get(o.get)}{lose(o.lose)}</span>
      </div>
    );
  }
  if (q.kind === 'one') {
    return (
      <RadioGroup value={value as string} onValueChange={(v) => onAnswer(v)} className="gap-2">
        {q.options.map((o) => <Choice key={o.id} value={o.id} title={o.title}><span className="mt-1 grid gap-1">{get(o.get)}{lose(o.lose)}</span></Choice>)}
      </RadioGroup>
    );
  }
  const picked = value as string[];
  if (!q.options.length) return <Text tone="muted">{q.detected}</Text>;
  return (
    <div className="grid gap-2">
      {q.note && <span className="text-xs text-base-700">{q.note}</span>}
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {q.options.map((o) => {
          const on = !o.disabled && picked.includes(o.id);
          return (
            <li key={o.id}>
              <label className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${o.disabled ? 'border-dashed border-base-300' : on ? 'cursor-pointer border-primary/60 bg-primary/5' : 'cursor-pointer border-base-300'}`}>
                <span className="pt-0.5"><Checkbox checked={on} disabled={!!o.disabled}
                  onChange={() => onAnswer(picked.includes(o.id) ? picked.filter((p) => p !== o.id) : [...picked, o.id])} /></span>
                <span className="grid gap-1">
                  <span className={`text-sm font-medium ${o.disabled ? 'text-base-700' : ''}`}>{o.title}</span>
                  {o.disabled
                    ? <><Line icon={<Lock className="size-3.5" />} label="You can’t pick this" text={o.limit!} tone="limit" />{lose(o.lose)}</>
                    : on
                      ? <>{get(o.get)}{lose(o.lose, 'Untick it and you give up', false)}</>
                      : <>{lose(o.lose)}{get(o.get, 'Tick it and you get', false)}</>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---- A3: consequence panel ------------------------------------------------------------------------------------------

function PanelPart({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-0.5"><span className="text-xs font-semibold text-base-700">{label}</span><span className="text-sm">{children}</span></div>;
}

/** Plain option labels on the left; one panel on the right saying what the selected option changes, what you lose and whether it can change later. */
function ConsequenceControl({ q, answers, onAnswer }: ControlProps) {
  const value = answerOf(q, answers);
  const [focus, setFocus] = useState(q.options[0]?.id);
  const picked = q.kind === 'many' ? value as string[] : [];
  const shown = q.kind === 'one' ? q.options.find((o) => o.id === value) : q.options.find((o) => o.id === focus);
  const off = q.kind === 'many' ? q.options.filter((o) => o.disabled || !picked.includes(o.id)) : [];

  let options: ReactNode;
  if (q.kind === 'text') options = <Input value={value as string} onChange={(e) => onAnswer(e.target.value)} aria-label={q.short} />;
  else if (q.kind === 'one') {
    options = (
      <RadioGroup value={value as string} onValueChange={(v) => onAnswer(v)} className="gap-2">
        {q.options.map((o) => <Choice key={o.id} value={o.id} title={o.title} />)}
      </RadioGroup>
    );
  } else if (!q.options.length) options = <Text tone="muted">{q.detected}</Text>;
  else {
    options = (
      <ul className="m-0 grid list-none gap-1 p-0">
        {q.options.map((o) => (
          <li key={o.id} onMouseEnter={() => setFocus(o.id)} onFocus={() => setFocus(o.id)} onClick={() => setFocus(o.id)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${focus === o.id ? 'bg-base-200 ring-1 ring-primary/50' : ''} ${o.disabled ? 'cursor-help text-base-700' : 'cursor-pointer'}`}>
            {o.disabled
              ? <><Lock className="size-4 shrink-0" />{o.title}</>
              : <label className="flex flex-1 cursor-pointer items-center gap-2.5"><Checkbox checked={picked.includes(o.id)}
                  onChange={() => onAnswer(picked.includes(o.id) ? picked.filter((p) => p !== o.id) : [...picked, o.id])} />{o.title}</label>}
          </li>
        ))}
      </ul>
    );
  }

  const on = shown && !shown.disabled && (q.kind !== 'many' || picked.includes(shown.id));
  const state = !shown ? null : shown.disabled ? 'Your access refuses this' : q.kind === 'many' ? (on ? 'Ticked' : 'Unticked') : q.kind === 'one' ? 'Selected' : null;
  return (
    <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="grid gap-2">
        {options}
        {q.kind === 'many' && q.options.length > 0 && <span className="text-xs text-base-700">Point at an option to see what it changes.</span>}
      </div>
      <aside aria-live="polite" className="grid gap-3 rounded-lg border border-base-300 bg-base-100 p-3.5 sm:sticky sm:top-0">
        {shown && (
          <div className="grid gap-0.5">
            <span className="text-sm font-semibold">{q.kind === 'text' ? q.short : shown.title}</span>
            {state && <span className={`text-xs ${shown.disabled ? 'text-(--lar-danger-text)' : 'text-base-700'}`}>{state}</span>}
          </div>
        )}
        {shown?.disabled
          ? <>
              <PanelPart label="Why you can’t pick it">{shown.limit}</PanelPart>
              <PanelPart label="What the factory does instead">{shown.lose}</PanelPart>
            </>
          : shown && (q.kind === 'many'
            ? <>
                <PanelPart label="What this changes">{on ? shown.get : shown.lose}</PanelPart>
                <PanelPart label={on ? 'If you untick it' : 'If you tick it'}>{on ? shown.lose : shown.get}</PanelPart>
              </>
            : <>
                <PanelPart label="What this changes">{shown.get}</PanelPart>
                <PanelPart label="What you lose">{shown.lose}</PanelPart>
              </>)}
        {off.length > 0 && (
          <PanelPart label="Off on this step">
            <span className="grid gap-0.5 text-xs">
              {off.map((o) => <span key={o.id} className="flex items-center gap-1.5">{o.disabled ? <Lock className="size-3 shrink-0" /> : <Minus className="size-3 shrink-0" />}{o.title}{o.disabled && ' (refused)'}</span>)}
            </span>
          </PanelPart>
        )}
        <PanelPart label="Can you change it later?">{q.later}</PanelPart>
      </aside>
    </div>
  );
}

// ---- The flow: round 1's variant A, with the variant's control on each question step -------------------------------

const CONTROLS: Record<VariantKey, (p: ControlProps) => ReactNode> = { A1: CostLineControl, A2: GainLossControl, A3: ConsequenceControl };

function Wizard({ scenario, answers, setAnswer, finish, variant }: VariantProps & { variant: VariantKey }) {
  const [step, setStep] = useState(0);
  const Control = CONTROLS[variant];
  const qs = scenario.questions;
  const total = qs.length + 2;
  const place = `Set up ${scenario.repo}. Step ${step + 1} of ${total}.`;
  const nav = (
    <>
      {step > 0 && <Button {...kind('other')} onClick={() => setStep(step - 1)}>Back</Button>}
      {step < total - 1
        ? <Button {...kind('main')} rightIcon={<ArrowRight />} onClick={() => setStep(step + 1)}>Next</Button>
        : <Button {...kind('main')} leftIcon={<Check />} onClick={finish}>Finish</Button>}
    </>
  );
  if (step === 0) {
    return (
      <Shell title="What we found" help="Read from the provider and the repository. Nothing here is a question." place={place} progress={[step, total]} footer={nav}>
        <DetectedList scenario={scenario} />
      </Shell>
    );
  }
  if (step === total - 1) {
    return (
      <Shell title="Asked later" help="These wait until a feature needs them." place={place} progress={[step, total]} footer={nav}>
        <DeferredList />
      </Shell>
    );
  }
  const q = qs[step - 1]!;
  return (
    <Shell title={q.title} help={q.detected} place={place} progress={[step, total]} footer={nav}>
      <span className="flex items-center gap-2 text-xs text-base-700"><Origin q={q} changed={changedOf(q, answers)} /> Default preselected; change it if it’s wrong.</span>
      <Control key={q.id} q={q} answers={answers} onAnswer={(v) => setAnswer(q.id, v)} />
    </Shell>
  );
}

// ---- Finished, root and bar -----------------------------------------------------------------------------------------

function Finished({ scenario, answers, back }: { scenario: Scenario; answers: Answers; back: () => void }) {
  return (
    <Shell title="Onboarded" help="Prototype: nothing was written." place={`Set up ${scenario.repo}.`} progress={[1, 1]}
      footer={<Button {...kind('other')} onClick={back}>Start again</Button>}>
      <Alert tone="success" title={`${scenario.repo} is on the board`}>Stub only: no settings, consent or files were saved.</Alert>
      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
        {scenario.questions.map((q) => <li key={q.id}><span className="text-base-700">{q.short}:</span> {answerText(q, answers)}</li>)}
      </ul>
    </Shell>
  );
}

function Bar({ variant, scenario, inDialog }: { variant: VariantKey | null; scenario: Scenario; inDialog: boolean }) {
  const keys = Object.keys(VARIANTS) as VariantKey[];
  const cycle = (d: number) => setParams({ variant: keys[(keys.indexOf(variant ?? 'A1') + d + keys.length) % keys.length]! });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable], [role=radio]')) return;
      // preventDefault so a focused scenario select doesn't also step its option.
      if (e.key === 'ArrowLeft') { e.preventDefault(); cycle(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); cycle(1); }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });
  const pill = 'grid size-7 place-items-center rounded-full hover:bg-white/15';
  const bar = (
    <div data-prototype-bar className={inDialog
      ? 'order-first flex shrink-0 items-center justify-center gap-1 bg-neutral-900 px-1.5 py-1 text-xs text-white'
      : 'fixed top-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-900 px-1.5 py-1 text-xs text-white shadow-lg ring-1 ring-white/20'}>
      <span className="px-2 font-medium">Prototype #691</span>
      <span className="h-4 w-px bg-white/25" />
      <button type="button" className={pill} aria-label="Previous variant" onClick={() => cycle(-1)}><ChevronLeft className="size-4" /></button>
      <span className="min-w-44 text-center">{variant ? `${variant} (${VARIANTS[variant]})` : 'Closed'}</span>
      <button type="button" className={pill} aria-label="Next variant" onClick={() => cycle(1)}><ChevronRight className="size-4" /></button>
      <span className="h-4 w-px bg-white/25" />
      <select className="rounded-full bg-transparent px-2 py-1 text-white" aria-label="Scenario" value={scenario.id} onChange={(e) => setParams({ scenario: e.target.value })}>
        {SCENARIOS.map((s) => <option key={s.id} value={s.id} className="text-black">{s.id}. {s.name}</option>)}
      </select>
    </div>
  );
  // With the dialog closed there's no modal to join, so it floats at the top of the board.
  return inDialog ? bar : createPortal(bar, document.body);
}

/** Mounted by the wizard dialog in prototype builds: the picked variant over the board, and the bar. */
export function PrototypeFlow() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const v = params.get('variant');
  const variant = v && v in VARIANTS ? v as VariantKey : null;
  const scenario = SCENARIOS.find((s) => s.id === params.get('scenario')) ?? SCENARIOS[0]!;
  const [answers, setAnswers] = useState<Record<string, Answers>>({});
  const [finished, setFinished] = useState<Record<string, boolean>>({});
  if (!PROTOTYPE_691) return null;
  const current = answers[scenario.id] ?? {};
  const props: VariantProps = {
    scenario, answers: current,
    setAnswer: (id, value) => setAnswers({ ...answers, [scenario.id]: { ...current, [id]: value } }),
    finish: () => setFinished({ ...finished, [scenario.id]: true }),
  };
  // Keyed by variant and scenario so the wizard's step starts fresh on a scenario switch; answers persist across variants.
  const key = `${variant}-${scenario.id}`;
  return (
    <BarSlot.Provider value={<Bar variant={variant} scenario={scenario} inDialog />}>
      {variant && (finished[scenario.id]
        ? <Finished scenario={scenario} answers={current} back={() => { setFinished({ ...finished, [scenario.id]: false }); setAnswers({ ...answers, [scenario.id]: {} }); }} />
        : <Wizard key={key} variant={variant} {...props} />)}
      {!variant && <Bar variant={variant} scenario={scenario} inDialog={false} />}
    </BarSlot.Provider>
  );
}
