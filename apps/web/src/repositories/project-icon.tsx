// A repository's icon, in a fixed square. An emoji or monogram chosen in T3 takes the square. Otherwise it holds the
// toned initial, with the T3 favicon or lucide icon laid over it once that has loaded, so the square keeps its size
// either way and a missing or broken one leaves the initial. Decorative, as a name sits beside it. An SVG favicon only
// ever renders through this <img>, which runs none of its scripts.

import { lazy, Suspense, useState, type ComponentProps, type ComponentType } from 'react';
import type { DynamicIcon, IconName } from 'lucide-react/dynamic';
import { repoName, repositoryProjectIcon, type ProjectIconColor } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { repoTone } from '../items/item-parts.tsx';

const SIZES = {
  small: { square: 'size-3.5 text-[8px]', emoji: 'text-[10px]', monogram: 'text-[7px]' },
  medium: { square: 'size-5 text-[10px]', emoji: 'text-sm', monogram: 'text-[10px]' },
};

/** Whole class names, as Tailwind only finds those. */
const COLORS: Record<ProjectIconColor, string> = {
  gray: 'text-gray-500',
  red: 'text-red-500',
  orange: 'text-orange-500',
  amber: 'text-amber-500',
  yellow: 'text-yellow-500',
  lime: 'text-lime-500',
  green: 'text-green-500',
  emerald: 'text-emerald-500',
  teal: 'text-teal-500',
  cyan: 'text-cyan-500',
  sky: 'text-sky-500',
  blue: 'text-blue-500',
  indigo: 'text-indigo-500',
  violet: 'text-violet-500',
  purple: 'text-purple-500',
  fuchsia: 'text-fuchsia-500',
  pink: 'text-pink-500',
  rose: 'text-rose-500',
};

const OVERLAY = 'absolute inset-0 size-full bg-base-100';

/** lucide's name map and its icons are lazy chunks, loaded when first shown. DynamicIcon draws nothing for a
 *  name lucide lacks or an icon that won't load, and a name map that won't load draws nothing here. */
const LucideIcon = lazy<ComponentType<ComponentProps<typeof DynamicIcon>>>(() => import('lucide-react/dynamic').then(
  (lucide) => ({ default: lucide.DynamicIcon }),
  () => ({ default: () => null }),
));

function Favicon({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt="" hidden={!loaded} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className={`${OVERLAY} object-contain`} />;
}

const firstTwoGraphemes = (text: string) => [...new Intl.Segmenter().segment(text)].slice(0, 2).map((part) => part.segment).join('');

export function ProjectIcon({ repo, size }: { repo: string; size: keyof typeof SIZES }) {
  const repos = useBoardStore((state) => state.data.repos);
  const icon = useBoardStore((state) => repositoryProjectIcon(state.data, repo));
  const { square, emoji, monogram } = SIZES[size];
  const shared = `${square} relative grid shrink-0 place-items-center overflow-hidden rounded-md font-bold`;
  if (icon?.kind === 'emoji') return <span data-project-icon className={shared} aria-hidden="true"><span className={emoji}>{icon.emoji}</span></span>;
  if (icon?.kind === 'monogram') return <span data-project-icon className={`${shared} ${COLORS[icon.color]}`} aria-hidden="true"><span className={`${monogram} whitespace-nowrap leading-none`}>{firstTwoGraphemes(icon.text)}</span></span>;
  const src = icon?.kind === 'favicon' ? `/api/project-icon/${encodeURIComponent(icon.projectId)}?v=${encodeURIComponent(icon.revision)}` : null;
  return (
    <span data-project-icon className={`${repoTone(repo, repos)} ${shared} bg-[var(--k,var(--color-base-600))] text-white`} aria-hidden="true">
      {repoName(repo, repos)[0]!.toUpperCase()}
      {src && <Favicon key={src} src={src} />}
      {icon?.kind === 'lucide' && <Suspense fallback={null}><LucideIcon key={icon.name} name={icon.name as IconName} className={`${OVERLAY} ${COLORS[icon.color]}`} /></Suspense>}
    </span>
  );
}
