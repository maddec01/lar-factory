// The bits every view draws for an item: its platform badge, kind pill, label pills, blocked-by badge and title link.
// The pills are T3's Badge; the board's CSS adds the coloured dot.

import { kindLabel, kindOf, plural, ref, slug } from '@mux-factory/shared';
import type { Item } from '@mux-factory/shared';
import { Badge } from '@mux-factory/ui/badge';

export function PlatformBadge({ platform }: { platform: string }) {
  return <Badge variant="outline" className={`plat plat-${slug(platform)}`}>{platform}</Badge>;
}

export function KindPill({ item }: { item: Item }) {
  return <Badge variant="outline" className={`kind kind-${kindOf(item)}`}>{kindLabel(item)}</Badge>;
}

export function BlockedBy({ count }: { count: number }) {
  return <Badge variant="error" className="blocked-by" title={`Blocked by ${plural(count, 'issue')}`}>blocked by {count}</Badge>;
}

export function TitleLink({ item, className = 'title' }: { item: Item; className?: string }) {
  const text = <><span className="ref">{ref(item)}</span> {item.title}</>;
  return item.url
    ? <a className={className} href={item.url} target="_blank" rel="noopener">{text}</a>
    : <span className={className}>{text}</span>;
}

/** One pill per GitHub label, kind included; a kind label keeps its colour. Always rendered, so it pushes a row's buttons to the end. */
export function LabelPills({ item }: { item: Item }) {
  return <span className="labels">{item.labels.map((l) => <Badge variant="outline" className={`label kind-${slug(l)}`} key={l}>{l}</Badge>)}</span>;
}
