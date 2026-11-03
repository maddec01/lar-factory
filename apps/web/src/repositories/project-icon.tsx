// A repository's icon: its toned initial in a fixed square, with the T3 favicon laid over it once the image has loaded,
// so the square keeps its size either way and a missing or broken image leaves the initial. Decorative, as a name sits
// beside it. An SVG only ever renders through this <img>, which runs none of its scripts.

import { useState } from 'react';
import { repoName, repositoryProjectIcon } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { repoTone } from '../items/item-parts.tsx';

const SIZES = { small: 'size-3.5 text-[8px]', medium: 'size-5 text-[10px]' };

function Favicon({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt="" hidden={!loaded} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className="absolute inset-0 size-full bg-base-100 object-contain" />;
}

export function ProjectIcon({ repo, size }: { repo: string; size: keyof typeof SIZES }) {
  const repos = useBoardStore((state) => state.data.repos);
  const icon = useBoardStore((state) => repositoryProjectIcon(state.data, repo));
  const src = icon?.kind === 'favicon' ? `/api/project-icon/${encodeURIComponent(icon.projectId)}?v=${encodeURIComponent(icon.revision)}` : null;
  return (
    <span data-project-icon className={`${repoTone(repo, repos)} ${SIZES[size]} relative grid shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--k,var(--color-base-600))] font-bold text-white`} aria-hidden="true">
      {repoName(repo, repos)[0]!.toUpperCase()}
      {src && <Favicon key={src} src={src} />}
    </span>
  );
}
