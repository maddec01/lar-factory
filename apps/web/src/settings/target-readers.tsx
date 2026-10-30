// Reader badges are shared by Settings and the install overview. Targets arrive physically deduplicated from the app.
import type { TargetSnapshot } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { useInstallStore } from './install-store.ts';

export function TargetReaders({ target }: { target: TargetSnapshot }) {
  const snapshot = useInstallStore((state) => state.snapshot);
  return <div className="flex flex-wrap gap-1" aria-label={`Provider instances reading ${target.path}`}>
    {target.instances.length ? target.instances.map((id) => {
      const instance = snapshot?.instances.find((instance) => instance.id === id);
      const name = instance?.displayName ?? id;
      const disabled = instance?.enabled === false;
      return <Badge key={id} data-reader={id} tone={disabled ? 'neutral' : 'accent'}
        className={disabled ? 'text-(--muted-foreground)' : undefined}
        aria-label={disabled ? `${name}. Disabled in T3 Code; still receives skills.` : name}>
        {name}{disabled ? ' · Disabled' : ''}
      </Badge>;
    }) : <span className="text-xs text-(--muted-foreground)">{target.locked ? 'Shared skill copies' : 'Manual target'}</span>}
  </div>;
}
