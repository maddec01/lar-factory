// THROWAWAY #525, round three. A is the saved layout. D moves the app's own controls to the app name; E centres the
// board's status. Scope, counters, List and Add item keep their existing components.
import type { ReactNode } from 'react';
import { ArrowUpToLine, ExternalLink } from 'lucide-react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { IconButton } from '@lar-factory/ui/design-system/IconButton';
import { TitleBar } from '@lar-factory/ui/design-system/TitleBar';
import { SettingsIcon } from '@lar-factory/ui/design-system/NavigationIcons';
import { AddItem } from '../add-item/add-item.tsx';
import { ListButton } from '../list/list-modal.tsx';
import { SettingsButton } from '../settings/settings.tsx';
import { Counters } from './counters.tsx';
import { TrafficLights } from './window-controls.tsx';
import { CONTROL } from './control.ts';
import { usePrototype525 } from './prototype-525-state.ts';

function T3Identity() {
  return <span className="prototype-t3 text-xs whitespace-nowrap text-base-700">for <span className="font-medium">T3 Code</span></span>;
}

/** Shows only while an update is available, as the real pill does. `short` reads "Update", for the tighter layouts. */
function Update({ short = false }: { short?: boolean }) {
  const { update, stub } = usePrototype525();
  if (!update) return null;
  return (
    <Button variant="quiet" className={`prototype-update ${CONTROL} rounded-full`}
      title="Update available · 0.1.525. Prototype action" aria-label="Update available"
      leftIcon={<ArrowUpToLine />} onClick={() => stub('Download update selected')}>
      {short ? 'Update' : 'Update available'}
    </Button>
  );
}

/** A: the saved checkpoint, as round one drew it. */
function Saved({ brand, scope, refreshed }: Parts) {
  return (
    <TitleBar brand={<div className="prototype-brand-identity flex shrink-0 items-center gap-3">{brand}<T3Identity /></div>}
      title={<>{scope}{refreshed}</>}
      actions={<>
        <Counters /><ListButton /><AddItem />
        <div className="prototype-utilities flex shrink-0 items-center gap-1 border-l border-base-300 pl-2"><Update /><SettingsButton /></div>
      </>} />
  );
}

/** D: the app's own controls sit with its name, on the leading edge. The divider then separates the app from the
 *  board, and the row ends on Add item, the board's primary action. */
function AppCorner({ brand, scope, refreshed }: Parts) {
  return (
    <TitleBar
      brand={<div className="prototype-app-corner flex shrink-0 items-center gap-2">
        <span className="flex items-baseline gap-2">{brand}<T3Identity /></span>
        <span className="flex items-center gap-1"><SettingsButton /><Update short /></span>
      </div>}
      title={<>{scope}{refreshed}</>}
      actions={<><Counters /><ListButton /><AddItem /></>} />
  );
}

/** E: where you are on the left, how the board is doing in the middle, what you can do on the right. */
function CentredStatus({ brand, scope, refreshed }: Parts) {
  return (
    <TitleBar brand={<div className="flex shrink-0 items-baseline gap-2">{brand}<T3Identity /></div>}
      title={<>
        {scope}
        <div className="prototype-status flex items-center gap-0.5 rounded-lg border border-base-300 bg-base-200/60 pl-1.5 pr-0.5">
          {refreshed}<span aria-hidden="true" className="mx-0.5 h-4 w-px bg-base-300" /><Counters />
        </div>
      </>}
      actions={<>
        <ListButton /><AddItem />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-base-300" />
        <Update short /><SettingsButton />
      </>} />
  );
}

type Parts = { brand: ReactNode; scope: ReactNode; refreshed: ReactNode };
const LAYOUTS = { A: Saved, D: AppCorner, E: CentredStatus } as const;

export function PrototypeTitleBar({ inset, ...parts }: Parts & { inset: string }) {
  const { variant } = usePrototype525();
  const Layout = LAYOUTS[variant];
  return (
    <div data-title-variant={variant} className="title-bar prototype-title-bar shrink-0 select-none border-b border-base-300 [-webkit-app-region:drag] [&_:is(button,a,[tabindex])]:[-webkit-app-region:no-drag]">
      <TrafficLights />
      <h1 className="sr-only" tabIndex={-1}>Lar Factory</h1>
      <div className={inset}><Layout {...parts} /></div>
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
