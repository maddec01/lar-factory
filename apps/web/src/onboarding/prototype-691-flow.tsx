// PROTOTYPE (#691), throwaway, round 3: three ways onboarding presents the choices it defers, mounted in the onboarding
// wizard's dialog and switched with ?variant=D1|D2|D3 and ?scenario=1|2|3 from the bar at the top of the dialog. Every
// variant is round 2's A1 (one question per step, detected default preselected, a cost line under each option); only
// the deferred choices differ. After Finish, "Preview a later prompt" opens the same just-in-time prompts in all three.
// Stub data only; Finish writes nothing.
//   D1: a final "Asked later" step lists each deferred choice. D2: each step says, in one line, the choice deferred from
//   it. D3: onboarding never mentions them; the closing note says the factory asks the rest when it needs them.

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Clock, Hourglass } from 'lucide-react';
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
  DEFERRED, LATER, LOCAL_NOTE, PROTOTYPE_691, SCENARIOS, answerOf, answerText, deferredOnStep,
  type Answers, type LaterOption, type Question, type Scenario,
} from './prototype-691-scenarios.ts';

const VARIANTS = { D1: 'List at the end', D2: 'Said on the related step', D3: 'Nothing until needed' } as const;
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
  title: string; help: string; place: string; progress?: [number, number]; children: ReactNode; footer: ReactNode;
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
          {progress && <Progress value={progress[0]} max={progress[1]} caption={`${progress[0]} of ${progress[1]}`} aria-label={`${progress[0]} of ${progress[1]}`} />}
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

type ControlProps = { q: Question; answers: Answers; onAnswer: (v: string | string[]) => void };

// ---- The flow: A1 in every variant; only the deferred choices' presentation differs ---------------------------------

/** D2: the one line a step says about the choice deferred from it. */
function DeferredHint({ text }: { text: string }) {
  return (
    <span className="flex items-start gap-2 border-t border-base-300 pt-3 text-xs text-base-700">
      <Clock className="mt-px size-3.5 shrink-0" />{text}
    </span>
  );
}

function Wizard({ scenario, answers, setAnswer, finish, variant }: VariantProps & { variant: VariantKey }) {
  const [step, setStep] = useState(0);
  const qs = scenario.questions;
  // Only D1 adds the final "Asked later" step.
  const total = qs.length + (variant === 'D1' ? 2 : 1);
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
  if (variant === 'D1' && step === total - 1) {
    return (
      <Shell title="Asked later" help="These wait until a feature needs them." place={place} progress={[step, total]} footer={nav}>
        <DeferredList />
      </Shell>
    );
  }
  const q = qs[step - 1]!;
  const hint = variant === 'D2' ? deferredOnStep(scenario, q.id) : null;
  return (
    <Shell title={q.title} help={q.detected} place={place} progress={[step, total]} footer={nav}>
      <span className="flex items-center gap-2 text-xs text-base-700"><Origin q={q} changed={changedOf(q, answers)} /> Default preselected; change it if it’s wrong.</span>
      <CostLineControl key={q.id} q={q} answers={answers} onAnswer={(v) => setAnswer(q.id, v)} />
      {hint && <DeferredHint text={hint} />}
    </Shell>
  );
}

// ---- Later prompts: the same in every variant -----------------------------------------------------------------------

/** A1 again: each option with its cost line and a Refused badge when access blocks it; the detected default preselected. */
function LaterChoice({ options, value, onChange, label }: { options: LaterOption[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <RadioGroup value={value} onValueChange={onChange} aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <Choice key={o.id} value={o.id} disabled={!!o.disabled}
          title={<span className="flex items-center gap-2">{o.title}{o.disabled && <Badge tone="danger">{o.disabled}</Badge>}</span>}>{o.cost}</Choice>
      ))}
    </RadioGroup>
  );
}

function Limits({ limits }: { limits: string[] }) {
  if (!limits.length) return null;
  return <Alert tone="warning" title="What your access allows">{limits.join(' ')}</Alert>;
}

function Trigger({ text }: { text: string }) {
  return <span className="flex items-start gap-2 text-sm"><Hourglass className="mt-0.5 size-4 shrink-0 text-base-700" />{text}</span>;
}

function PublishPrompt({ scenario, done }: { scenario: Scenario; done: () => void }) {
  const p = LATER[scenario.id].publish;
  const [where, setWhere] = useState(p.where.fallback);
  const [map, setMap] = useState<Record<string, string>>({});
  const handover = where === 'handover';
  return (
    <Shell title="Before you publish" help="Asked once, the first time you publish refined work. Change it later in Settings."
      place={scenario.repo} footer={<><Button {...kind('other')} onClick={done}>Not now</Button><Button {...kind('main')} onClick={done}>Publish</Button></>}>
      <Trigger text={p.trigger} />
      <Limits limits={p.limits} />
      <section className="grid gap-2">
        <span className="text-sm font-semibold">{p.where.title}</span>
        <span className="flex items-center gap-2 text-xs text-base-700"><Badge>Detected</Badge>{p.where.detected}</span>
        <LaterChoice label={p.where.title} options={p.where.options} value={where} onChange={setWhere} />
      </section>
      <section className={`grid gap-3 ${handover ? 'opacity-60' : ''}`}>
        <span className="grid gap-0.5">
          <span className="text-sm font-semibold">Vocabulary mapping</span>
          <span className="text-xs text-base-700">{handover ? 'The handover writes each kind as a line in the text you post.' : p.mappingHelp}</span>
        </span>
        {!handover && p.mapping.map((row) => {
          const value = map[row.term] ?? row.fallback;
          return (
            <div key={row.term} className="grid gap-1.5">
              <span className="flex items-center gap-2 text-sm">
                <span className="font-medium">{row.term}</span><span className="text-xs text-base-700">{row.what}</span>
                {value !== row.fallback ? <Badge tone="accent">Changed</Badge> : <Badge>Detected</Badge>}
              </span>
              <LaterChoice label={row.term} options={row.options} value={value} onChange={(v) => setMap({ ...map, [row.term]: v })} />
            </div>
          );
        })}
      </section>
    </Shell>
  );
}

function AdditionPrompt({ scenario, done }: { scenario: Scenario; done: () => void }) {
  const a = LATER[scenario.id].addition;
  const [value, setValue] = useState(a.question.fallback);
  return (
    <Shell title="A repository addition would help" help="Offered once, when a feature would use it. Nothing is added unless you choose it."
      place={scenario.repo} footer={<><Button {...kind('other')} onClick={done}>Close</Button><Button {...kind('main')} onClick={done}>Continue</Button></>}>
      <Trigger text={a.trigger} />
      <Limits limits={a.limits} />
      <section className="grid gap-2">
        <span className="text-sm font-semibold">{a.question.title}</span>
        <span className="flex items-center gap-2 text-xs text-base-700"><Badge>Detected</Badge>{a.question.detected}</span>
        <LaterChoice label={a.question.title} options={a.question.options} value={value} onChange={setValue} />
      </section>
    </Shell>
  );
}

// ---- Finished, root and bar -----------------------------------------------------------------------------------------

function Finished({ scenario, answers, variant, back }: { scenario: Scenario; answers: Answers; variant: VariantKey; back: () => void }) {
  const [prompt, setPrompt] = useState<'publish' | 'addition' | null>(null);
  if (prompt === 'publish') return <PublishPrompt scenario={scenario} done={() => setPrompt(null)} />;
  if (prompt === 'addition') return <AdditionPrompt scenario={scenario} done={() => setPrompt(null)} />;
  return (
    <Shell title="Onboarded" help="Prototype: nothing was written." place={`Set up ${scenario.repo}.`} progress={[1, 1]}
      footer={<Button {...kind('other')} onClick={back}>Start again</Button>}>
      <Alert tone="success" title={`${scenario.repo} is on the board`}>Stub only: no settings, consent or files were saved.</Alert>
      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
        {scenario.questions.map((q) => <li key={q.id}><span className="text-base-700">{q.short}:</span> {answerText(q, answers)}</li>)}
      </ul>
      {variant === 'D3' && <Text tone="muted">The factory asks the rest when it needs them.</Text>}
      <div data-prototype-later className="grid gap-2 rounded-lg border border-dashed border-base-400 p-3">
        <span className="text-xs font-semibold text-base-700">Prototype: preview a later prompt</span>
        <div className="flex flex-wrap gap-2">
          <Button {...kind('other')} onClick={() => setPrompt('publish')}>First publication</Button>
          <Button {...kind('other')} onClick={() => setPrompt('addition')}>Repository addition: {scenario.id === '2' ? 'tags' : 'labels'}</Button>
        </div>
      </div>
    </Shell>
  );
}

function Bar({ variant, scenario, inDialog }: { variant: VariantKey | null; scenario: Scenario; inDialog: boolean }) {
  const keys = Object.keys(VARIANTS) as VariantKey[];
  const cycle = (d: number) => setParams({ variant: keys[(keys.indexOf(variant ?? 'D1') + d + keys.length) % keys.length]! });
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
      <span className="min-w-52 text-center">{variant ? `${variant} (${VARIANTS[variant]})` : 'Closed'}</span>
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
  // Keyed by variant and scenario so each variant walks to its own Finish; answers persist across variants.
  const key = `${variant}-${scenario.id}`;
  const props: VariantProps = {
    scenario, answers: current,
    setAnswer: (id, value) => setAnswers({ ...answers, [scenario.id]: { ...current, [id]: value } }),
    finish: () => setFinished({ ...finished, [key]: true }),
  };
  return (
    <BarSlot.Provider value={<Bar variant={variant} scenario={scenario} inDialog />}>
      {variant && (finished[key]
        ? <Finished key={key} scenario={scenario} answers={current} variant={variant} back={() => { setFinished({ ...finished, [key]: false }); setAnswers({ ...answers, [scenario.id]: {} }); }} />
        : <Wizard key={key} variant={variant} {...props} />)}
      {!variant && <Bar variant={variant} scenario={scenario} inDialog={false} />}
    </BarSlot.Provider>
  );
}
