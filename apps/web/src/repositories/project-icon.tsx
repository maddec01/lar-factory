// A project's icon, in a fixed square. An emoji or monogram chosen in T3 takes the square. Otherwise it holds the
// toned initial, with the T3 favicon or lucide icon laid over it once that has loaded, so the square keeps its size
// either way and a missing or broken one leaves the initial. Decorative, as a name sits beside it. An SVG favicon only
// ever renders through this <img>, which runs none of its scripts.

import { lazy, memo, Suspense, useState, type ComponentProps, type ComponentType } from 'react';
import type { DynamicIcon, IconName } from 'lucide-react/dynamic';
import { repoName, repositoryProjectIcon, sameRepo, type ProjectChoice, type ProjectIcon as Icon, type ProjectIconColor, type RepoConfig } from '@lar-factory/shared';
import { useShallow } from 'zustand/react/shallow';
import { useBoardStore } from '../board/board-store.ts';

const REPO_TONES = 8;

/** A repository's colour class: the palette entry for its place among the board's repositories, or the muted
 *  colour for a repository the board doesn't list. `repo` is a repository key. */
export function repoTone(repo: string, repos: readonly RepoConfig[]): string {
  const at = repos.findIndex((r) => sameRepo(r.repo, repo));
  return at < 0 ? 'repo-tone-none' : `repo-tone-${at % REPO_TONES}`;
}

const SIZES = {
  small: { square: 'size-3.5 text-[8px]', emoji: 'text-[10px]', monogram: 'text-[7px]' },
  row: { square: 'size-4 text-[9px]', emoji: 'text-xs', monogram: 'text-[8px]' },
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

const graphemes = new Intl.Segmenter();
const firstGraphemes = (text: string, count: number) => {
  let shown = '';
  let length = 0;
  for (const { segment } of graphemes.segment(text)) {
    shown += segment;
    if (++length === count) break;
  }
  return shown;
};

function IconSquare({ icon, name, tone, size }: { icon: Icon | null | undefined; name: string; tone: string; size: keyof typeof SIZES }) {
  const { square, emoji, monogram } = SIZES[size];
  const shared = `${square} relative grid shrink-0 place-items-center overflow-hidden rounded-md font-bold`;
  if (icon?.kind === 'emoji') return <span data-project-icon className={shared} aria-hidden="true"><span className={emoji}>{icon.emoji}</span></span>;
  if (icon?.kind === 'monogram') return <span data-project-icon className={`${shared} ${COLORS[icon.color]}`} aria-hidden="true"><span className={`${monogram} whitespace-nowrap leading-none`}>{firstGraphemes(icon.text, 2)}</span></span>;
  const src = icon?.kind === 'favicon' ? `/api/project-icon/${encodeURIComponent(icon.projectId)}?v=${encodeURIComponent(icon.revision)}` : null;
  return (
    <span data-project-icon className={`${tone} ${shared} bg-[var(--k,var(--color-base-600))] text-white`} aria-hidden="true">
      {firstGraphemes(name, 1).toUpperCase()}
      {src && <Favicon key={src} src={src} />}
      {icon?.kind === 'lucide' && <Suspense fallback={null}><LucideIcon key={icon.name} name={icon.name as IconName} className={`${OVERLAY} ${COLORS[icon.color]}`} /></Suspense>}
    </span>
  );
}

/** The icon of a repository the board knows. */
export const ProjectIcon = memo(function ProjectIcon({ repo, size }: { repo: string; size: keyof typeof SIZES }) {
  // A push makes new repos and icons, so this selects what they say here, not those objects.
  const name = useBoardStore((state) => repoName(repo, state.data.repos));
  const tone = useBoardStore((state) => repoTone(repo, state.data.repos));
  const icon = useBoardStore(useShallow((state) => repositoryProjectIcon(state.data, repo)));
  return <IconSquare icon={icon} name={name} tone={tone} size={size} />;
});

/** The icon of a T3 project, which the board may not know: most of onboarding's projects aren't on it. */
export function ProjectChoiceIcon({ project, size }: { project: ProjectChoice; size: keyof typeof SIZES }) {
  const tone = useBoardStore((state) => project.repo ? repoTone(project.repo, state.data.repos) : 'repo-tone-none');
  return <IconSquare icon={project.icon} name={project.name} tone={tone} size={size} />;
}
