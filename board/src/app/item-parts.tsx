// The bits every view draws for an item: its platform badge, kind pill and title link.

import { kindLabel, kindOf, platformOf, ref } from '../model.ts';
import type { BoardData, Item } from '../model.ts';
import { slug } from '../format.ts';

export function PlatformBadge({ item, data }: { item: Item; data: BoardData }) {
  const platform = platformOf(item, data.repos);
  return <span className={`plat plat-${slug(platform)}`}>{platform}</span>;
}

export function KindPill({ item }: { item: Item }) {
  return <span className={`kind kind-${kindOf(item)}`}>{kindLabel(item)}</span>;
}

export function TitleLink({ item, className = 'title' }: { item: Item; className?: string }) {
  const text = <><span className="ref">{ref(item)}</span> {item.title}</>;
  return item.url
    ? <a className={className} href={item.url} target="_blank" rel="noopener">{text}</a>
    : <span className={className}>{text}</span>;
}
