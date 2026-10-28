// THROWAWAY #525. App utilities move; scope, counters, List and Add item keep their existing components.
import type { ReactNode } from 'react';
import { ArrowUpToLine, Check, ExternalLink, SquareTerminal } from 'lucide-react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { IconButton } from '@lar-factory/ui/design-system/IconButton';
import { TitleBar } from '@lar-factory/ui/design-system/TitleBar';
import { SettingsIcon } from '@lar-factory/ui/design-system/NavigationIcons';
import { AddItem } from '../add-item/add-item.tsx';
import { ListButton } from '../list/list-modal.tsx';
import { SettingsButton } from '../settings/settings.tsx';
import { useSettingsStore } from '../settings/settings-store.ts';
import { Counters } from './counters.tsx';
import { TrafficLights } from './window-controls.tsx';
import { CONTROL } from './control.ts';
import { usePrototype525 } from './prototype-525-state.ts';

function T3Identity() {
  return <span className="prototype-t3 text-xs whitespace-nowrap text-base-700">for <span className="font-medium">T3 Code</span></span>;
}

function Update({ persistent = false }: { persistent?: boolean }) {
  const { update, stub } = usePrototype525();
  if (!update && !persistent) return null;
  return (
    <Button variant="quiet" className={`${update ? 'prototype-update' : ''} ${persistent ? 'prototype-utility-update' : ''} ${CONTROL}`}
      title={update ? 'Update available · 0.1.525. Prototype action' : 'Up to date. Check again. Prototype action'}
      aria-label={update ? 'Update available' : 'Up to date. Check for updates'}
      leftIcon={update ? <ArrowUpToLine /> : <Check />} onClick={() => stub(update ? 'Download update selected' : 'Check for updates selected')}>
      <span className={persistent ? 'prototype-utility-label' : undefined}>{update ? 'Update available' : 'Up to date'}</span>
    </Button>
  );
}

function Utilities() {
  return <div className="prototype-utilities flex shrink-0 items-center gap-1 border-l border-base-300 pl-2"><Update /><SettingsButton /></div>;
}

function BoardActions() {
  return <><Counters /><ListButton /><AddItem /></>;
}

/** App identity and housekeeping share a home in B and C, outside the board's scope. */
function AppUtilities({ rail = false }: { rail?: boolean }) {
  return (
    <aside id="prototype-app-utilities" tabIndex={rail ? undefined : -1} className={rail ? 'prototype-app-rail' : 'prototype-app-status'} aria-label="App utilities">
      <span className="prototype-app-identity flex items-center gap-2 whitespace-nowrap text-xs text-base-700" title="lar Factory for T3 Code">
        <SquareTerminal className="size-4 shrink-0" aria-hidden="true" />
        <span className="prototype-identity-label">for <span className="font-medium">T3 Code</span></span>
      </span>
      <div className="prototype-app-tools flex gap-1">
        <Update persistent />
        <Button variant="quiet" className={`prototype-utility-settings ${CONTROL}`} leftIcon={<SettingsIcon />} aria-label="Settings" title="Settings"
          onClick={() => useSettingsStore.getState().setOpen(true)}><span className="prototype-utility-label">Settings</span></Button>
      </div>
    </aside>
  );
}

/** The rail spends width; the status bar spends height. A's existing title layout stays intact. */
export function PrototypeWorkArea({ children }: { children: ReactNode }) {
  const variant = usePrototype525((state) => state.variant);
  if (variant === 'B') return <div className="prototype-work-area flex min-h-0 min-w-0 flex-1"><AppUtilities rail />{children}</div>;
  if (variant === 'C') return <>{children}<AppUtilities /></>;
  return <>{children}</>;
}

type Props = { brand: ReactNode; scope: ReactNode; refreshed: ReactNode; inset: string };

export function PrototypeTitleBar({ brand, scope, refreshed, inset }: Props) {
  const { variant } = usePrototype525();
  return (
    <div data-title-variant={variant} className="title-bar prototype-title-bar shrink-0 select-none border-b border-base-300 [-webkit-app-region:drag] [&_:is(button,a,[tabindex])]:[-webkit-app-region:no-drag]">
      <TrafficLights />
      <h1 className="sr-only" tabIndex={-1}>Lar Factory</h1>
      {variant === 'C' && <a href="#prototype-app-utilities" className="prototype-app-skip sr-only focus:not-sr-only">App utilities</a>}
      {variant === 'A' && <div className={inset}>
        <TitleBar brand={<div className="prototype-brand-identity flex shrink-0 items-center gap-3">{brand}<T3Identity /></div>}
          title={<>{scope}{refreshed}</>} actions={<><BoardActions /><Utilities /></>} />
      </div>}
      {variant === 'B' && <div className={inset}>
        <TitleBar brand={brand}
          title={<>{scope}{refreshed}</>} actions={<BoardActions />} />
      </div>}
      {variant === 'C' && <div className={inset}>
        <TitleBar brand={brand} title={<>{scope}{refreshed}</>} actions={<BoardActions />} />
      </div>}
    </div>
  );
}

/** A small specimen beside the controls, independent from both design choices. */
export function PrototypeSizeSamples() {
  const stub = usePrototype525((state) => state.stub);
  return <div className="prototype-size-samples flex flex-wrap items-center gap-2">
    <span className="text-xs text-base-700">28px</span>
    <Button variant="secondary" onClick={() => stub('Ordinary button selected')}>Action</Button>
    <IconButton variant="header" icon={<SettingsIcon />} title="28px icon action" aria-label="28px icon action" onClick={() => stub('Icon action selected')} />
    <a data-slot="button" className="inline-flex items-center gap-1 rounded-md border border-base-400 bg-base-100 px-2 font-medium" href="#prototype-link" onClick={(event) => { event.preventDefault(); stub('Button link selected'); }}>Link <ExternalLink className="size-3.5" /></a>
  </div>;
}
