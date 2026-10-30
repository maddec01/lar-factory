// PROTOTYPE (#691), throwaway: three flow shapes for onboarding's questions, mounted in the onboarding wizard's dialog
// and switched with ?variant=A|B|C and ?scenario=1|2|3 from a floating bar. Only the flow shape differs: the cost
// lines, the detected facts and the deferred list are the same components in every variant. Stub data only; Finish
// writes nothing.
//   A: step per question. B: summary first, change rows one at a time. C: ask only what's uncertain, then a recap.

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Clock, Pencil } from 'lucide-react';
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
  DEFERRED, LOCAL_NOTE, PROTOTYPE_691, SCENARIOS, answerCost, answerOf, answerText, type Answers, type Question, type Scenario,
} from './prototype-691-scenarios.ts';

const VARIANTS = { A: 'Step per question', B: 'Summary first', C: 'Ask only what’s uncertain' } as const;
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

/** The control for one question: each option with its cost line, the detected default preselected. */
function QuestionControl({ q, answers, onAnswer }: { q: Question; answers: Answers; onAnswer: (v: string | string[]) => void }) {
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid gap-2"><h3 className="m-0 text-sm font-semibold">{title}</h3>{children}</section>;
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

// ---- Variant A: step per question -----------------------------------------------------------------------------------

function VariantA({ scenario, answers, setAnswer, finish }: VariantProps) {
  const [step, setStep] = useState(0);
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
      <QuestionControl q={q} answers={answers} onAnswer={(v) => setAnswer(q.id, v)} />
    </Shell>
  );
}

// ---- Variant B: summary first ---------------------------------------------------------------------------------------

function VariantB({ scenario, answers, setAnswer, finish }: VariantProps) {
  const [open, setOpen] = useState<Question['id'] | null>(null);
  const changed = scenario.questions.filter((q) => changedOf(q, answers)).length;
  return (
    <Shell title="Check your setup" help="Everything onboarding would set, with what each answer costs. Change any row, one at a time."
      place={`Set up ${scenario.repo}. ${scenario.questions.length} answers, ${changed} changed.`} progress={[1, 1]}
      footer={<Button {...kind('main')} leftIcon={<Check />} disabled={open !== null} onClick={finish}>Looks right</Button>}>
      <div className="grid divide-y divide-base-300 rounded-lg border border-base-300">
        {scenario.questions.map((q) => (
          <div key={q.id} className={`grid gap-2 px-4 py-3 ${open === q.id ? 'bg-primary/5' : ''}`}>
            <div className="flex items-start gap-3">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-xs text-base-700">{q.short} <Origin q={q} changed={changedOf(q, answers)} /></span>
                <span className="text-sm font-medium">{answerText(q, answers)}</span>
                {open !== q.id && <span className="text-xs text-base-700">{answerCost(q, answers)}</span>}
              </div>
              {open === q.id
                ? <Button {...kind('other')} onClick={() => setOpen(null)}>Done</Button>
                : <Button {...kind('other')} disabled={open !== null} onClick={() => setOpen(q.id)}>Change</Button>}
            </div>
            {open === q.id && <div className="grid gap-2"><Text tone="muted">{q.title} {q.detected}</Text><QuestionControl q={q} answers={answers} onAnswer={(v) => setAnswer(q.id, v)} /></div>}
          </div>
        ))}
      </div>
      <Section title="Found, not asked"><DetectedList scenario={scenario} /></Section>
      <Section title="Asked later"><DeferredList /></Section>
    </Shell>
  );
}

// ---- Variant C: ask only what's uncertain ---------------------------------------------------------------------------

function VariantC({ scenario, answers, setAnswer, finish }: VariantProps) {
  const asked = scenario.questions.filter((q) => !q.settled);
  const [step, setStep] = useState(0);
  const [reopened, setReopened] = useState<Question['id'] | null>(null);
  const total = asked.length + 1;
  const recap = step >= asked.length;
  const place = `Set up ${scenario.repo}. ${recap ? 'Recap' : `Question ${step + 1} of ${asked.length}`}; ${scenario.questions.length - asked.length} set for you.`;
  if (!recap) {
    const q = asked[step]!;
    return (
      <Shell title={q.title} help={`Detection can’t settle this. ${q.detected}`} place={place} progress={[step, total]}
        footer={<>{step > 0 && <Button {...kind('other')} onClick={() => setStep(step - 1)}>Back</Button>}<Button {...kind('main')} rightIcon={<ArrowRight />} onClick={() => setStep(step + 1)}>Next</Button></>}>
        <QuestionControl q={q} answers={answers} onAnswer={(v) => setAnswer(q.id, v)} />
      </Shell>
    );
  }
  const settled = scenario.questions.filter((q) => q.settled);
  return (
    <Shell title="Here’s what’s set" help="Your answers, what was set for you, and what waits until later." place={place} progress={[total, total]}
      footer={<>{asked.length > 0 && <Button {...kind('other')} onClick={() => setStep(asked.length - 1)}>Back</Button>}<Button {...kind('main')} leftIcon={<Check />} onClick={finish}>Finish</Button></>}>
      <Section title="You answered">
        <ul className="m-0 grid list-none gap-1 p-0 text-sm">
          {asked.map((q) => <li key={q.id}><span className="text-base-700">{q.short}:</span> {answerText(q, answers)}</li>)}
        </ul>
      </Section>
      <Section title="Set for you">
        <ul className="m-0 grid list-none gap-2 p-0">
          {settled.map((q) => (
            <li key={q.id} className="grid gap-1.5">
              <div className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-(--lar-success-text)" />
                <span className="min-w-0 flex-1"><span className="text-base-700">{q.short}:</span> {answerText(q, answers)} <Origin q={q} changed={changedOf(q, answers)} />
                  <span className="block text-xs text-base-700">{answerCost(q, answers)}</span></span>
                <Button {...kind('other')} leftIcon={<Pencil />} onClick={() => setReopened(reopened === q.id ? null : q.id)}>{reopened === q.id ? 'Done' : 'Change'}</Button>
              </div>
              {reopened === q.id && <div className="ml-6"><QuestionControl q={q} answers={answers} onAnswer={(v) => setAnswer(q.id, v)} /></div>}
            </li>
          ))}
        </ul>
        <DetectedList scenario={scenario} />
      </Section>
      <Section title="Asked later"><DeferredList /></Section>
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
  const cycle = (d: number) => setParams({ variant: keys[(keys.indexOf(variant ?? 'A') + d + keys.length) % keys.length]! });
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
  // Keyed by scenario so each variant's own place (step, open row) starts fresh on a scenario switch; answers persist across variants.
  const key = `${variant}-${scenario.id}`;
  return (
    <BarSlot.Provider value={<Bar variant={variant} scenario={scenario} inDialog />}>
      {variant && (finished[scenario.id]
        ? <Finished scenario={scenario} answers={current} back={() => { setFinished({ ...finished, [scenario.id]: false }); setAnswers({ ...answers, [scenario.id]: {} }); }} />
        : variant === 'A' ? <VariantA key={key} {...props} /> : variant === 'B' ? <VariantB key={key} {...props} /> : <VariantC key={key} {...props} />)}
      {!variant && <Bar variant={variant} scenario={scenario} inDialog={false} />}
    </BarSlot.Provider>
  );
}
