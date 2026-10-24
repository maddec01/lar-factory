// PROTOTYPE, throwaway. Variant D, "Docked companion": the app as a narrow strip (~380 px) that snaps beside
// T3 Code's window, the way an inspector sits beside an editor. Tabs split the flow; a row opens in place.
// Settings stays at the foot's left, where T3 puts it, and pushes in as its own stack with Back in the same
// spot. In a wide window a ghost of T3 Code fills the rest, to judge the pairing.

import { useState } from 'react';
import { ArrowLeft, ChevronRight, PanelRight, Plus, Settings } from 'lucide-react';
import { boardSections, inMacApp, platformOf, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { IconButton, Logo, PlatformDot, PlatformTag, StatusGlyph, TrafficLights, drag, noDrag } from './chrome.tsx';
import { ActionButtons, PrList, SliceList, StepTrack, hint, refText } from './item-bits.tsx';
import { SettingsBody, pages } from './proto-settings.tsx';

function Row({ item, data, now, open, onToggle }: { item: Item; data: BoardData; now: number; open: boolean; onToggle: () => void }) {
  return (
    <li className={`rounded-lg ${open ? 'bg-(--card) shadow-xs ring-1 ring-(--border)' : ''}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-(--row-hover)">
        <StatusGlyph status={item.status} className="mt-0.5 size-3.5" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={`leading-snug ${open ? 'font-medium' : 'line-clamp-1'}`}>{item.title}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-(--muted-foreground)"><PlatformDot item={item} data={data} />{refText(item)} · {item.status} · {shortAgo(item.updatedAt, now)}</span>
        </span>
        <ChevronRight className={`mt-0.5 size-3.5 text-(--muted-foreground) transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-3 px-2.5 pb-3">
          <StepTrack status={item.status} />
          {hint(item) && <p className="m-0 rounded-md bg-(--warning-surface) px-2 py-1.5 text-xs font-medium text-(--warning-foreground)">{hint(item)}</p>}
          {item.slices.length > 0 && <SliceList item={item} />}
          {item.linkedPrs.length > 0 && <PrList item={item} />}
          <div className="flex items-center gap-2"><PlatformTag platform={platformOf(item, data.repos)} /><span className="ml-auto"><ActionButtons item={item} small /></span></div>
        </div>
      )}
    </li>
  );
}

function GhostT3() {
  return (
    <div className="hidden min-w-0 flex-1 border-r border-(--border) opacity-60 md:flex" aria-hidden="true">
      <div className="w-[240px] border-r border-(--border) bg-(--sidebar) p-3">
        <div className="mb-4 h-4 w-24 rounded bg-(--soft)" />
        {Array.from({ length: 9 }, (_, i) => <div key={i} className="mb-2 h-3 rounded bg-(--soft)" style={{ width: `${55 + ((i * 37) % 40)}%` }} />)}
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex h-[52px] items-center border-b border-(--border) px-4 text-xs text-(--muted-foreground)">T3 Code · mux-work thread</div>
        <div className="grid flex-1 content-start gap-3 p-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-3 rounded bg-(--soft)" style={{ width: `${40 + ((i * 23) % 50)}%` }} />)}</div>
        <div className="m-4 h-20 rounded-2xl border border-(--border) bg-(--card)" />
      </div>
    </div>
  );
}

export function VariantD() {
  const { data, now } = useBoardStore();
  const s = boardSections(data, now);
  const tabs = [
    { id: 'you', label: 'You', items: s.needsYou },
    { id: 'flow', label: 'Flow', items: [...s.inFlight, ...s.concepts] },
    { id: 'queue', label: 'Queue', items: s.queued },
    { id: 'list', label: 'List', items: s.list },
    { id: 'done', label: 'Done', items: s.done },
  ];
  const [tab, setTab] = useState('you');
  const [open, setOpen] = useState<string | null>(null);
  const [settings, setSettings] = useState<string | null | false>(false);
  const all = pages(data);
  const current = tabs.find((t) => t.id === tab)!;
  const page = settings ? all.find((p) => p.id === settings) : null;
  return (
    <div className="proto fixed inset-0 flex bg-(--background) text-(--foreground)">
      {!inMacApp() && <GhostT3 />}
      <div className="flex w-full max-w-[400px] shrink-0 flex-col bg-(--sidebar) md:w-[380px]">
        <header className={`flex h-[52px] shrink-0 items-center gap-2 border-b border-(--border) pl-4 pr-2 ${drag}`}>
          <TrafficLights />
          <span className="inline-flex items-baseline gap-1 text-sm font-medium"><Logo /><span className="text-(--muted-foreground)">Factory</span></span>
          <span className={`ml-auto flex ${noDrag}`}><IconButton label="Add item"><Plus /></IconButton><IconButton label="Dock side"><PanelRight /></IconButton></span>
        </header>
        {settings === false ? (
          <>
            <div className="flex shrink-0 gap-0.5 border-b border-(--border) px-2 py-1.5">
              {tabs.map((t) => (
                <button key={t.id} type="button" onClick={() => { setTab(t.id); setOpen(null); }}
                  className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-md text-xs font-medium ${tab === t.id ? 'bg-(--row-active)' : 'text-(--muted-foreground) hover:bg-(--row-hover)'}`}>
                  {t.label}<span className={`tabular-nums ${t.id === 'you' && t.items.length ? 'rounded-full bg-(--warning) px-1 text-[10px] text-black' : 'text-(--muted-foreground)'}`}>{t.items.length}</span>
                </button>
              ))}
            </div>
            <ul className="m-0 grid min-h-0 flex-1 list-none content-start gap-1 overflow-y-auto p-2">
              {current.items.map((i) => <Row key={i.id} item={i} data={data} now={now} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} />)}
              {!current.items.length && <li className="p-6 text-center text-(--muted-foreground)">Nothing here.</li>}
            </ul>
          </>
        ) : page ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <h2 className="m-0 mb-3 px-1 text-sm font-medium">{page.label}</h2>
            <SettingsBody page={page} compact />
          </div>
        ) : (
          <nav className="min-h-0 flex-1 overflow-y-auto p-2">
            {all.map((p) => (
              <button key={p.id} type="button" onClick={() => setSettings(p.id)} className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-(--row-hover) [&_svg]:size-4 [&_svg]:text-(--muted-foreground)">
                {p.icon}<span className="flex-1">{p.label}</span><ChevronRight />
              </button>
            ))}
          </nav>
        )}
        <footer className="flex h-11 shrink-0 items-center gap-1 border-t border-(--border) px-2">
          {settings === false
            ? <button type="button" onClick={() => setSettings(null)} className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-(--row-hover) [&_svg]:size-4 [&_svg]:text-(--muted-foreground)"><Settings />Settings</button>
            : <button type="button" onClick={() => setSettings(settings ? null : false)} className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-(--row-hover) [&_svg]:size-4 [&_svg]:text-(--muted-foreground)"><ArrowLeft />{settings ? 'Settings' : 'Back'}</button>}
          <span className="ml-auto pr-2 text-[11px] text-(--muted-foreground)">{data.fetchedAt ? `Refreshed ${shortAgo(data.fetchedAt, now)}` : ''}</span>
        </footer>
      </div>
    </div>
  );
}
