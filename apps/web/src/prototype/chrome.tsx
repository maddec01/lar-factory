// PROTOTYPE, throwaway. The T3 Code chrome the control room borrows: the brand row beside the traffic lights,
// sidebar rows and footer buttons, status glyphs, and the window drag rules.

import type { ReactNode } from 'react';
import { Check, Circle, CircleDashed, CircleDot, Clock3, Eye, GitMerge, LoaderCircle } from 'lucide-react';
import { BRAND_MARK_PATH, BRAND_MARK_VIEWBOX, inMacApp, slug } from '@mux-factory/shared';
import type { Status } from '@mux-factory/shared';
import { Badge } from '@mux-factory/ui/badge';
import { Button as UiButton } from '@mux-factory/ui/button';

export const drag = '[-webkit-app-region:drag]';
export const noDrag = '[-webkit-app-region:no-drag]';

/** Room for the Mac window's traffic lights; in a browser, grey stand-ins so the layout reads like the app. */
function TrafficLights() {
  if (inMacApp()) return <span className="w-[73px] shrink-0" />;
  return (
    <span className="flex w-[73px] shrink-0 gap-2 pl-1" aria-hidden="true">
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} className="size-3 rounded-full opacity-80" style={{ background: c }} />)}
    </span>
  );
}

function Logo({ className = 'h-[12.5px] w-[22px]' }: { className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} viewBox={BRAND_MARK_VIEWBOX} fill="none" aria-label="Mux">
      <path d={BRAND_MARK_PATH} stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** T3's sidebar header: traffic lights, then the brand, as "T3 Code [Alpha]" sits. */
export function BrandRow({ children }: { children?: ReactNode }) {
  return (
    <div className={`flex h-[52px] shrink-0 items-center gap-2 pl-4 pr-2 ${drag}`}>
      <TrafficLights />
      <span className="inline-flex items-baseline gap-1 text-sm font-medium tracking-tight">
        <Logo />
        <span className="text-(--muted-foreground)">Factory</span>
      </span>
      <Badge variant="secondary" size="sm" className="bg-accent">for T3 Code</Badge>
      <span className={`ml-auto flex items-center ${noDrag}`}>{children}</span>
    </div>
  );
}

export function SidebarButton({ icon, label, onClick, trailing, active }: { icon: ReactNode; label: ReactNode; onClick?: () => void; trailing?: ReactNode; active?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-(--sidebar-fg) hover:bg-(--row-hover) [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-(--sidebar-muted) ${active ? 'bg-(--row-active) font-medium' : ''}`}>
      {icon}<span className="min-w-0 flex-1 truncate">{label}</span>{trailing}
    </button>
  );
}

export function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-(--muted-foreground) hover:bg-(--row-hover) hover:text-(--foreground) [&_svg]:size-4">
      {children}
    </button>
  );
}

/** T3's Button from the design system: outline by default, the primary fill for the one action that matters. */
export function Button({ children, primary, onClick, small }: { children: ReactNode; primary?: boolean; onClick?: () => void; small?: boolean }) {
  return <UiButton variant={primary ? 'default' : 'outline'} size={small ? 'xs' : 'sm'} onClick={onClick}>{children}</UiButton>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-(--border) bg-(--muted) px-1 font-sans text-[10px] text-(--muted-foreground)">{children}</kbd>;
}

export const STATUS_COLOR: Record<Status, string> = {
  List: 'var(--st-idle)', Queued: 'var(--st-idle)', Shaping: 'var(--st-now)', 'Needs you': 'var(--st-amber)', Ready: 'var(--st-now)',
  'In progress': 'var(--st-now)', Review: 'var(--st-review)', Verify: 'var(--st-amber)', 'Ready to merge': 'var(--st-done)', Done: 'var(--st-done)',
};

/** One glyph per status, the way T3 marks a thread working, waiting or done. */
export function StatusGlyph({ status, className = 'size-3.5' }: { status: Status; className?: string }) {
  const style = { color: STATUS_COLOR[status] };
  const props = { className: `shrink-0 ${className}`, style, strokeWidth: 2.25 };
  switch (status) {
    case 'Needs you': case 'Verify': return <CircleDot {...props} className={`${props.className} proto-pulse`} />;
    case 'In progress': return <LoaderCircle {...props} className={`${props.className} animate-spin [animation-duration:2.4s]`} />;
    case 'Shaping': return <CircleDashed {...props} />;
    case 'Review': return <Eye {...props} />;
    case 'Ready to merge': return <GitMerge {...props} />;
    case 'Done': return <Check {...props} />;
    case 'Queued': return <Clock3 {...props} />;
    default: return <Circle {...props} />;
  }
}

const PLATFORM_COLOR: Record<string, string> = {
  server: 'oklch(68.5% 0.169 237.323)', apple: 'oklch(65.6% 0.241 354.308)', factory: 'oklch(70.4% 0.14 182.503)',
};
export const platformColor = (platform: string) => PLATFORM_COLOR[slug(platform)] ?? 'var(--muted-foreground)';

export function PlatformTag({ platform }: { platform: string }) {
  return (
    <Badge variant="outline" size="sm" className="gap-1.5 font-medium">
      <span className="size-[7px] rounded-full" style={{ background: platformColor(platform) }} />{platform}
    </Badge>
  );
}
