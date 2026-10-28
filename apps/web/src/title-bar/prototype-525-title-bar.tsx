// THROWAWAY #525, round three. E, the picked layout: the board's status centred, app controls labelled at the right.
// Scope, counters, List and Add item keep their existing components.
import type { ReactNode } from 'react';
import { ArrowUpToLine, MessageSquareText, Play, SquarePen } from 'lucide-react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { TitleBar } from '@lar-factory/ui/design-system/TitleBar';
import { SettingsIcon } from '@lar-factory/ui/design-system/NavigationIcons';
import { AddItem } from '../add-item/add-item.tsx';
import { ListButton } from '../list/list-modal.tsx';
import { useSettingsStore } from '../settings/settings-store.ts';
import { Counters } from './counters.tsx';
import { TrafficLights } from './window-controls.tsx';
import { CONTROL } from './control.ts';
import { usePrototype525 } from './prototype-525-state.ts';

/** Shows only while an update is available, as the real one does: an app control, tinted while it waits for you. */
function Update() {
  const { update, stub } = usePrototype525();
  if (!update) return null;
  return (
    <Button variant="quiet" className={`prototype-update ${CONTROL} px-2`} title="Update available · 0.1.525. Prototype action"
      aria-label="Update available" leftIcon={<ArrowUpToLine />} onClick={() => stub('Download update selected')}>Update</Button>
  );
}

/** Settings drawn as List is: an app control with its icon and its name, so it reads at a glance. */
function Settings() {
  return (
    <Button variant="quiet" className={`open-settings ${CONTROL} px-2`} leftIcon={<SettingsIcon />} title="Settings (⌘,)"
      onClick={() => useSettingsStore.getState().setOpen(true)}>Settings</Button>
  );
}

/** E: where you are on the left, how the board is doing in the middle, what you can do on the right. */
function CentredStatus({ brand, scope, refreshed }: Parts) {
  return (
    <TitleBar brand={brand}
      title={<>
        {scope}
        <div className="prototype-status flex items-center gap-0.5 rounded-lg border border-base-300 bg-base-200/60 pl-1.5 pr-0.5">
          {refreshed}<span aria-hidden="true" className="mx-0.5 h-4 w-px bg-base-300" /><Counters />
        </div>
      </>}
      actions={<>
        <ListButton /><AddItem />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-base-300" />
        <Update /><Settings />
      </>} />
  );
}

type Parts = { brand: ReactNode; scope: ReactNode; refreshed: ReactNode };


export function PrototypeTitleBar({ inset, ...parts }: Parts & { inset: string }) {
  const { variant } = usePrototype525();
  return (
    <div data-title-variant={variant} className="title-bar prototype-title-bar shrink-0 select-none border-b border-base-300 [-webkit-app-region:drag] [&_:is(button,a,[tabindex])]:[-webkit-app-region:no-drag]">
      <TrafficLights />
      <h1 className="sr-only" tabIndex={-1}>Lar Factory</h1>
      <div className={inset}><CentredStatus {...parts} /></div>
    </div>
  );
}

/** The four kinds of button, each with one look everywhere in the app. */
export function PrototypeButtonKinds() {
  const stub = usePrototype525((state) => state.stub);
  const kinds: [string, ReactNode][] = [
    ['Main action, one per area', <Button variant="primary" className={CONTROL} leftIcon={<SquarePen />} onClick={() => stub('Main action selected')}>Add item</Button>],
    ['Start', <Button variant="secondary" data-start="sample" className={CONTROL} leftIcon={<Play />} onClick={() => stub('Start selected')}>Start refining</Button>],
    ['Open', <Button variant="secondary" className={CONTROL} leftIcon={<MessageSquareText />} onClick={() => stub('Open selected')}>Open thread</Button>],
    ['App control', <Button variant="quiet" className={CONTROL} leftIcon={<SettingsIcon />} onClick={() => stub('App control selected')}>Settings</Button>],
  ];
  return <div className="prototype-kinds flex flex-wrap items-end gap-4">
    {kinds.map(([label, button]) => <span key={label} className="grid gap-1 text-[11px] text-base-700">{label}{button}</span>)}
  </div>;
}
