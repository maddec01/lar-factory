// Variant B's corner tray, in the page's existing notification stack. Only actual install work opens it.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { installOverviewTargets, installOverviewSucceeded, type InstallSnapshot } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { IconButton } from '@lar-factory/ui/design-system/IconButton';
import { Progress } from '@lar-factory/ui/progress';
import { toast } from '@lar-factory/ui/toasts';
import { useInstallStore } from '../settings/install-store.ts';
import { TargetProgress } from '../settings/target-progress.tsx';
import { closeKeepingFocus, DismissButton, useSuccessClose } from './toasts.tsx';

/** Read-only checks have no overview. Their Drift and errors keep the existing warnings. */
export const hasInstallWork = (snapshot: InstallSnapshot | null): boolean =>
  !!snapshot?.installs && snapshot.targets.some(({ operation }) => operation === 'install' || operation === 'replace');

export function InstallOverview() {
  const snapshot = useInstallStore((state) => state.snapshot);
  const follow = useInstallStore((state) => state.follow);
  const closing = useInstallStore((state) => state.closingOverview);
  const visible = !closing && hasInstallWork(snapshot) && (!snapshot?.overview || snapshot.overview === 'open');
  useEffect(follow, [follow]);
  useEffect(() => {
    if (!visible) return;
    const id = toast.create({ color: 'neutral', duration: 0, closable: false,
      description: <OverviewBody /> });
    return () => toast.dismiss(id);
  }, [visible]);
  return null;
}

function OverviewBody() {
  const snapshot = useInstallStore((state) => state.snapshot)!;
  const closeOverview = useInstallStore((state) => state.closeOverview);
  const [expanded, setExpanded] = useState(false);
  const details = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Ninna's toast makes its entire content atomic and live. This tray announces only its summary, not every skill.
  useLayoutEffect(() => {
    const entry = ref.current?.closest('[data-slot="toast"]');
    entry?.setAttribute('aria-live', 'off');
    entry?.setAttribute('aria-atomic', 'false');
  }, []);
  const targets = installOverviewTargets(snapshot);
  const running = targets.some((target) => target.running && target.operation !== 'check');
  const failed = !!snapshot.error || !!snapshot.blocked.length || !!snapshot.conflicts.length || targets.some(({ error, skills }) => error || skills.some(({ state }) => state === 'failed' || state === 'blocked'));
  useSuccessClose(ref, installOverviewSucceeded(snapshot), () => closeKeepingFocus(ref.current?.closest('[data-slot="toast"]') ?? null, () => closeOverview('automatic')));
  const completed = targets.filter(({ finished, homeMissing, error }) => finished && !homeMissing && !error).length;
  const title = running ? `Installing Release ${snapshot.version}'s skills` : failed ? 'Installation needs attention'
    : completed === targets.length ? `Release ${snapshot.version}'s skills are installed` : 'Installation incomplete';
  return <div ref={ref} data-install-overview className="grid gap-3" aria-live="off">
    <div>
      <DismissButton what=": install overview" onClick={(event) => closeKeepingFocus(event.currentTarget.closest('[data-slot="toast"]'), () => closeOverview('dismissed'))} />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-(--muted-foreground)">{completed} of {targets.length} targets installed</div>
        </div>
        <IconButton aria-label={expanded ? 'Collapse install overview' : 'Expand install overview'} aria-expanded={expanded}
          aria-controls={details} icon={expanded ? <ChevronDown /> : <ChevronUp />} onClick={() => setExpanded(!expanded)} />
      </div>
    </div>
    <ul className="m-0 grid list-none gap-3 p-0">
      {targets.map((target) => {
        const installed = target.skills.filter(({ state }) => state === 'installed').length;
        return <li key={target.path} className="grid gap-1">
          <code className="text-xs">{target.path}</code>
          <div className="flex flex-wrap gap-1">
            {target.instances.length ? target.instances.map((id) => {
              const instance = snapshot.instances.find((instance) => instance.id === id);
              return <Badge key={id} className={instance?.enabled === false ? 'opacity-50' : ''}>
                {instance?.displayName ?? id}{instance?.enabled === false ? ' (disabled)' : ''}
              </Badge>;
            }) : <span className="text-xs text-(--muted-foreground)">No provider instances reported</span>}
          </div>
          {target.homeMissing && <p className="m-0 text-xs text-(--muted-foreground)">Not installed until {target.path.replace(/\/skills$/, '')} exists.</p>}
          <Progress aria-label={`Skills installed in ${target.path}`} value={installed} max={target.skills.length || 1}
            caption={`${installed}/${target.skills.length}`} />
        </li>;
      })}
    </ul>
    {snapshot.discovery !== 'available' && <p className="m-0 text-xs text-(--muted-foreground)">
      {snapshot.discovery === 'waiting' ? 'Waiting for T3 Code to list its provider instances.' : "T3 Code hasn't answered. The app will keep trying."} Fallback targets stay available.
    </p>}
    <div id={details} hidden={!expanded} className="grid gap-3">
      {expanded && targets.map((target) => <section key={target.path} aria-label={target.path} className="grid gap-1 border-t border-(--border) pt-2">
        <code className="text-xs">{target.path}</code>
        <TargetProgress target={target} showProgress={false} />
      </section>)}
      {expanded && snapshot.error && <p className="m-0 text-xs">{snapshot.error} Check access to the install targets, then Retry in Settings &gt; Skills.</p>}
    </div>
    {failed && !expanded && <p className="m-0 text-xs">Expand for errors and Clash paths. Recovery is also available in Settings &gt; Skills.</p>}
  </div>;
}
