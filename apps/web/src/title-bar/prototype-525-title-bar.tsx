// THROWAWAY #525. App utilities move; scope, counters, List and Add item keep their existing components.
import type { ReactNode } from 'react';
import { ArrowUpToLine, ChevronDown, Check, ExternalLink } from 'lucide-react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { IconButton } from '@lar-factory/ui/design-system/IconButton';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
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

function Update() {
  const { update, stub } = usePrototype525();
  if (!update) return null;
  return (
    <Button variant="quiet" className={`prototype-update ${CONTROL}`}
      title="Update available · 0.1.525. Prototype action" aria-label="Update available"
      leftIcon={<ArrowUpToLine />} onClick={() => stub('Download update selected')}>
      <span>Update available</span>
    </Button>
  );
}

function Utilities() {
  return <div className="prototype-utilities flex shrink-0 items-center gap-1 border-l border-base-300 pl-2"><Update /><SettingsButton /></div>;
}

function BoardActions() {
  return <><Counters /><ListButton /><AddItem /></>;
}

function AppMenu() {
  const { update, stub } = usePrototype525();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="quiet" className={`${CONTROL} prototype-app-menu gap-1 px-1.5`} aria-label={`App menu${update ? ', update available' : ''}`} rightIcon={<ChevronDown />}>
          <span>App</span>{update && <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Label>lar Factory · for T3 Code</DropdownMenu.Label>
        <DropdownMenu.Item onSelect={() => stub('Open T3 Code selected')}><ExternalLink className="size-4" />Open T3 Code</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => stub(update ? 'Download update selected' : 'Check for updates selected')}>
          {update ? <ArrowUpToLine className="size-4" /> : <Check className="size-4" />}{update ? 'Update available' : 'Up to date · Check again'}
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => useSettingsStore.getState().setOpen(true)}><SettingsIcon />Settings</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

type Props = { brand: ReactNode; scope: ReactNode; refreshed: ReactNode; inset: string };

export function PrototypeTitleBar({ brand, scope, refreshed, inset }: Props) {
  const { variant } = usePrototype525();
  return (
    <div data-title-variant={variant} className="title-bar prototype-title-bar shrink-0 select-none border-b border-base-300 [-webkit-app-region:drag] [&_:is(button,a,[tabindex])]:[-webkit-app-region:no-drag]">
      <TrafficLights />
      <h1 className="sr-only" tabIndex={-1}>Lar Factory</h1>
      {variant === 'A' && <div className={inset}>
        <TitleBar brand={<div className="prototype-brand-identity flex shrink-0 items-center gap-3">{brand}<T3Identity /></div>}
          title={<>{scope}{refreshed}</>} actions={<><BoardActions /><Utilities /></>} />
      </div>}
      {variant === 'B' && <div className={inset}>
        <TitleBar brand={<div className="flex shrink-0 items-center gap-1">{brand}<AppMenu /></div>}
          title={<>{scope}{refreshed}</>} actions={<BoardActions />} />
      </div>}
      {variant === 'C' && <>
        <div className={inset}>
          <TitleBar brand={brand} title={<T3Identity />} actions={<div className="flex items-center gap-1"><Update /><SettingsButton /></div>} />
        </div>
        <div className="prototype-board-strip @container flex h-11 min-w-0 items-center gap-1 border-t border-base-300 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-1">{scope}{refreshed}</div>
          <div className="flex shrink-0 items-center gap-1.5"><BoardActions /></div>
        </div>
      </>}
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
