// PROTOTYPE (#363), throwaway: what the board and Settings › Repositories show around the wizard, the same in every
// variant: the empty state, the onboarding cards with Resume, the offer for T3 projects that have a Repository
// config, the repository rows with Reset, and the floating variant switcher.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, FileText, FolderGit2, Play, Plus, RotateCcw } from 'lucide-react';
import {
  AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle,
} from '@lar-factory/ui/alert-dialog';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Badge } from '@lar-factory/ui/badge';
import { Button } from '@lar-factory/ui/button';
import { Card } from '@lar-factory/ui/card';
import { BrandMark } from '../brand/brand-mark.tsx';
import { T3_PROJECTS, repoOf } from './mock.ts';
import { stepSummary } from './steps.tsx';
import { STEPS, VARIANTS, useWizardStore } from './wizard-store.ts';

/** T3 projects whose repository has a `.lar-factory.json` and isn't on the board yet. */
function useDetected() {
  const repos = useWizardStore((s) => s.repos);
  return T3_PROJECTS.filter((p) => p.config && !repos.some((r) => r.repo === repoOf(p.origin)));
}

function DetectedOffers() {
  const start = useWizardStore((s) => s.start);
  return useDetected().map((p) => (
    <Alert key={p.name} variant="info"><FileText />
      <AlertTitle>{p.name} already has a Repository config</AlertTitle>
      <AlertDescription>{repoOf(p.origin)} has <code>.lar-factory.json</code> on its default branch. Onboarding reuses its answers and only runs the checks and the cleanup.</AlertDescription>
      <AlertAction><Button size="xs" onClick={() => start(p.name)}>Onboard {p.name}</Button></AlertAction>
    </Alert>
  ));
}

function OnboardingCards() {
  const { repos, resume } = useWizardStore();
  return repos.filter((r) => r.state === 'onboarding').map((r) => {
    const step = STEPS.find((s) => s.id === r.run?.step);
    return (
      <Card key={r.repo} accent className="flex-row flex-wrap items-center gap-3">
        <FolderGit2 className="size-4 text-muted-foreground" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">{r.repo}<Badge variant="warning" size="sm">Onboarding</Badge></span>
          <span className="text-xs text-muted-foreground">{r.run && step ? `${step.label}: ${stepSummary(r.run, step.id)}` : ''}</span>
        </div>
        <Button size="xs" variant="outline" disabled title="Start build waits for onboarding’s PR to merge"><Play /> Start build</Button>
        <Button size="xs" onClick={() => resume(r.repo)}>Resume</Button>
      </Card>
    );
  });
}

/** Above the board's banners: repositories being onboarded and the offers for ones with a Repository config. */
export function BoardSlot() {
  return <div className="grid gap-2 empty:hidden"><OnboardingCards /><DetectedOffers /></div>;
}

/** The main area while no repository is onboarded. */
export function EmptyState() {
  const start = useWizardStore((s) => s.start);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-xl gap-6 px-6 py-16">
        <div className="grid justify-items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-xl border bg-card"><BrandMark /></span>
          <h2 className="m-0 text-lg font-semibold">No repository is onboarded yet</h2>
          <p className="m-0 text-sm text-muted-foreground">Onboarding connects a repository and its T3 project to the board: it picks the item source, checks the commands the factory runs, and opens one PR that clears any Clash and adds the Repository config.</p>
          <Button onClick={() => start()}><Plus /> Onboard a repository</Button>
        </div>
        <div className="grid gap-2"><OnboardingCards /><DetectedOffers /></div>
      </div>
    </div>
  );
}

function ResetDialog({ repo, onClose }: { repo: string | null; onClose: () => void }) {
  const reset = useWizardStore((s) => s.reset);
  return (
    <AlertDialog open={!!repo} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset {repo}?</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="grid gap-2">
            <span>Resetting:</span>
            <ul className="m-0 grid list-disc gap-0.5 ps-5">
              <li>drops {repo} from this Mac’s list of onboarded repositories, so the board stops showing its items, and drops an onboarding still waiting for its PR, with its Resume</li>
              <li>opens a PR removing <code>.lar-factory.json</code>, the <code>## Agent skills</code> block and <code>docs/agents/</code>. Others who onboarded it lose its Repository config once it merges.</li>
            </ul>
            <span>It leaves alone the T3 project and the labels and statuses on its items.</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="xs" />}>Cancel</AlertDialogClose>
          <Button variant="destructive" size="xs" onClick={() => { if (repo) reset(repo); onClose(); }}>Reset</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/** Settings › Repositories in the prototype: every repository with its onboarding state, Resume or Reset, and Add repository. */
export function RepositoriesGroup() {
  const { repos, resume, start } = useWizardStore();
  const [resetting, setResetting] = useState<string | null>(null);
  return (
    <section className="grid gap-2">
      <div className="px-1">
        <h3 className="m-0 text-[13px] font-medium">Repositories</h3>
        <p className="m-0 text-xs text-muted-foreground">Each repository’s Repository config lives in its own .lar-factory.json; this Mac keeps only the list.</p>
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {repos.length === 0 && <div className="px-4 py-3 text-xs text-muted-foreground">No repository is onboarded.</div>}
        {repos.map((r) => (
          <div key={r.repo} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 truncate text-[13px] font-medium">{r.repo}
                {r.state === 'onboarding' ? <Badge variant="warning" size="sm">Onboarding</Badge> : <Badge variant="success" size="sm">Onboarded</Badge>}</div>
              <div className="text-xs text-muted-foreground">{r.platform}{r.role && ` · ${r.role}`}</div>
            </div>
            {r.state === 'onboarding' && <Button size="xs" onClick={() => resume(r.repo)}>Resume</Button>}
            <Button size="xs" variant="outline" onClick={() => setResetting(r.repo)}><RotateCcw /> Reset</Button>
          </div>
        ))}
        <div className="bg-muted px-4 py-2"><Button size="xs" variant="outline" onClick={() => start()}><Plus /> Add repository</Button></div>
      </div>
      <ResetDialog repo={resetting} onClose={() => setResetting(null)} />
    </section>
  );
}

/** The prototype's floating bar: ← variant →, the empty-board toggle. Not part of the design being judged. */
export function PrototypeSwitcher() {
  const { variant, setVariant, empty, setEmpty, close } = useWizardStore();
  const i = VARIANTS.findIndex((v) => v.key === variant);
  const go = (step: number) => { close(); setVariant(VARIANTS[(i + step + VARIANTS.length) % VARIANTS.length]!.key); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  // In body, outside the sidebar wrapper's stacking context, so it sits above a dialog's viewport too.
  return createPortal(
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-900 px-1.5 py-1 text-xs text-white shadow-lg ring-1 ring-white/20">
      <button type="button" aria-label="Previous variant" className="grid size-7 place-items-center rounded-full hover:bg-white/15" onClick={() => go(-1)}><ChevronLeft className="size-4" /></button>
      <span className="min-w-32 text-center font-medium">{variant} ({VARIANTS[i]!.name})</span>
      <button type="button" aria-label="Next variant" className="grid size-7 place-items-center rounded-full hover:bg-white/15" onClick={() => go(1)}><ChevronRight className="size-4" /></button>
      <span className="mx-1 h-4 w-px bg-white/25" />
      <label className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 hover:bg-white/15">
        <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Empty board
      </label>
    </div>,
    document.body,
  );
}
