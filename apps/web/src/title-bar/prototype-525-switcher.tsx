// THROWAWAY #525. This switcher exists only in the dedicated dev runner.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { IconButton } from '@lar-factory/ui/design-system/IconButton';
import { deskChoices, titleChoices, softQueue, usePrototype525 } from './prototype-525-state.ts';
import { PrototypeButtonKinds } from './prototype-525-title-bar.tsx';

export function PrototypeSwitcher() {
  const { variant, update, desk, choose, message, stub } = usePrototype525();
  const [expanded, setExpanded] = useState(true);
  const cycle = (delta: number) => {
    const keys = Object.keys(titleChoices);
    choose('variant', keys[(keys.indexOf(variant) + delta + keys.length) % keys.length]!);
  };
  useEffect(() => {
    document.documentElement.dataset.prototype525 = '';
    document.documentElement.dataset.queueTreatment = 'soft';
    return () => {
      delete document.documentElement.dataset.prototype525;
      delete document.documentElement.dataset.queueTreatment;
    };
  }, []);
  useEffect(() => { document.documentElement.dataset.desk = desk; }, [desk]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target.closest('input, textarea, select, button, a, [contenteditable], [role="menu"], [role="dialog"]')) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        cycle(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    const onLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (link && !link.getAttribute('href')?.startsWith('#') && /^(https?:|t3code:)/.test(link.href)) {
        event.preventDefault();
        stub(link.hasAttribute('data-open-thread') ? 'Open thread selected' : 'External link selected');
      }
    };
    addEventListener('keydown', onKey);
    document.addEventListener('click', onLink, true);
    return () => { removeEventListener('keydown', onKey); document.removeEventListener('click', onLink, true); };
  }, [variant]);
  return (
    <aside className="prototype-switcher fixed left-1/2 z-[100] grid w-[54rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 gap-2 rounded-xl border border-base-500 bg-base-100 px-3 py-2 text-xs text-base-content shadow-lg"
      aria-label="Throwaway prototype controls">
      <div className="flex flex-wrap items-center gap-2">
        <span className="prototype-warning rounded-sm bg-base-900 px-2 py-1 font-semibold text-base-100">THROWAWAY #525</span>
        <div className="flex items-center gap-1">
          <span className="min-w-40 text-center font-medium" aria-live="polite">{variant} · {titleChoices[variant][0]}</span>
        </div>
        <label className="flex items-center gap-1.5">Update
          <select aria-label="Update state" value={update ? 'available' : 'idle'} onChange={(event) => choose('update', event.target.value)} className="h-7 rounded-md border border-base-400 bg-base-100 px-2">
            <option value="available">Available</option><option value="idle">Idle</option>
          </select>
        </label>
        <IconButton variant="header" icon={expanded ? <ChevronDown /> : <ChevronUp />} className="ml-auto" aria-label={expanded ? 'Collapse prototype details' : 'Expand prototype details'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} />
      </div>
      {!expanded && <span className="sr-only" role="status">{message}</span>}
      {expanded && <>
        <div className="grid gap-1 border-t border-base-300 pt-2 text-base-700 sm:grid-cols-2 sm:gap-4">
          <p className="m-0"><span className="font-medium text-base-content">Title bar. </span>{titleChoices[variant][1]}</p>
          <p className="m-0"><span className="font-medium text-base-content">Desk. </span>{deskChoices[desk]}</p>
          <p className="m-0"><span className="font-medium text-base-content">Buttons. </span>{softQueue}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PrototypeButtonKinds />
          <Button variant="quiet" onClick={() => document.querySelector('.queue')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>Show Queue</Button>
          <span className="min-w-0 text-base-700" role="status">{message}</span>
        </div>
      </>}
    </aside>
  );
}
