// Variant C of the source-icon prototype: a corner tab on cards, a bordered square in rows and details.
import { Laptop } from 'lucide-react';
import { onAzure, type Item } from '@lar-factory/shared';

const SOURCE_TEXT = {
  github: 'GitHub issue. Saved on GitHub.',
  azure: 'Azure DevOps work item. Saved in Azure DevOps.',
  local: 'Saved only on this machine.',
};

/** The ticket determines the source, including when its provider's details haven't loaded yet. */
export function SourceIcon({ item, corner = false, className = '' }: { item: Pick<Item, 'number' | 'repo' | 'azure'>; corner?: boolean; className?: string }) {
  const source = !item.number ? 'local' : item.azure || onAzure(item.repo) ? 'azure' : 'github';
  const shape = corner
    ? 'absolute right-0 top-0 z-10 size-6 rounded-bl-lg rounded-tr-[inherit] border-b border-l'
    : 'size-5 shrink-0 rounded-md border';
  return (
    <span role="img" aria-label={SOURCE_TEXT[source]} title={SOURCE_TEXT[source]}
      className={`grid place-items-center bg-(--soft) text-(--muted-foreground) border-(--border) ${shape} ${className}`}>
      {source === 'local' ? <Laptop className="size-3" strokeWidth={1.75} aria-hidden="true" />
        : source === 'github'
          ? <svg viewBox="0 0 16 16" fill="currentColor" className="size-3" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
          : <svg viewBox="0 0 24 24" fill="currentColor" className="size-3" aria-hidden="true"><path d="M0 8.899l2.247-2.966 8.405-3.416V.045l7.37 5.393L2.966 8.36v8.2L0 15.685zm24-4.45v14.652L18.247 24l-9.303-3.237v3.237l-5.978-7.44 15.056 1.79V5.438z" /></svg>}
    </span>
  );
}
