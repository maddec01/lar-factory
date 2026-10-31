import { useEffect, useId, useRef, useState } from 'react';
import { writeHeaders, type Item, type LinkedPr } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { kind } from '../buttons/button-kinds.tsx';
import { useBoardStore } from '../board/board-store.ts';

type Evidence = { available: true; sourceRevision: string; observedAt: string; blockers: string[] } | { available: false; reason: string };

function blockerLabel(blocker: string): string {
  const [kind, ...parts] = blocker.split(':');
  const state = parts.pop() ?? 'unknown';
  const name = parts.join(':');
  if (kind === 'reviewer') {
    const vote = ({ '-10': 'rejected the pull request', '-5': 'requested changes', '0': 'has not approved', '5': 'approved with suggestions', '10': 'approved' } as Record<string, string>)[state] ?? 'has an unknown vote';
    return `Reviewer ${name}: ${vote}. Check reviewer requirements in Azure.`;
  }
  if (kind === 'policy') return `Required policy ${name}: ${state}. Check the policy in Azure.`;
  if (kind === 'status') return `Check ${name}: ${state}.`;
  return blocker;
}

export function PrReadiness({ item, pr }: { item: Item; pr: LinkedPr }) {
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [evidence, setEvidence] = useState<Evidence>();
  const [settledKey, setSettledKey] = useState<string>();
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const disconnected = useBoardStore((s) => s.clientError || s.data.itemSourceProblems?.find((p) => p.repo === item.repo)?.problem);
  const key = JSON.stringify([item.id, pr.number, pr.url, pr.sourceRevision, pr.state, pr.isDraft, pr.mergeState,
    pr.checks?.passed, pr.checks?.failed, pr.checks?.running, pr.checks?.total, pr.checks?.since, attempt]);
  const stale = loading || settledKey !== key;
  useEffect(() => {
    const request = ++sequence.current;
    setLoading(true);
    if (!open || disconnected) return;
    const controller = new AbortController();
    void fetch('/api/pr-readiness', { method: 'POST', headers: writeHeaders(), body: JSON.stringify({ itemId: item.id, number: pr.number }), signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Azure evidence is unavailable. Refresh to try again.');
        return response.json() as Promise<{ evidence: Evidence }>;
      }).then(({ evidence: next }) => {
        if (sequence.current === request) { setEvidence(next); setSettledKey(key); setLoading(false); }
      }).catch(() => {
        if (sequence.current === request) { setEvidence({ available: false, reason: 'Azure evidence is unavailable. Refresh to try again.' }); setSettledKey(key); setLoading(false); }
      });
    return () => { ++sequence.current; controller.abort(); };
  }, [open, item.id, pr.number, disconnected, key]);
  if (!item.azure) return null;
  return <div className="basis-full text-xs text-(--muted-foreground)">
    <Button {...kind('other')} aria-expanded={open} aria-controls={detailsId} onClick={() => { setLoading(true); setOpen(!open); }}>Readiness details</Button>
    {open && <div id={detailsId} role="status" aria-live="polite">
      <p>{disconnected ? 'Readiness unavailable: disconnected.' : stale ? 'Refreshing current revision. Previous evidence is stale.' : evidence?.available ? pr.sourceRevision && evidence.sourceRevision !== pr.sourceRevision ? 'Source revision changed. Refresh readiness.' : pr.isDraft || pr.state !== 'open' || evidence.blockers.length ? 'Readiness blocked.' : 'Ready to merge based on this observation.' : evidence?.reason}</p>
      {evidence?.available && <><p>Observed <time dateTime={evidence.observedAt}>{evidence.observedAt}</time> · revision {evidence.sourceRevision}</p><ul>{evidence.blockers.map((b) => <li key={b}>{blockerLabel(b)}</li>)}</ul></>}
      <p>T3 Azure PR context is unsupported; evidence comes from Azure.</p>
      <Button {...kind('other')} onClick={() => { setLoading(true); setAttempt((n) => n + 1); }}>Refresh readiness</Button>
    </div>}
  </div>;
}
