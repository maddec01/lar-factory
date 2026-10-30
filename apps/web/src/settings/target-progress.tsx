// Skill work and retained results, with recovery through the desktop-owned installer.
import type { TargetSnapshot } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useDriftStore } from '../notices/drift-store.ts';
import { useInstallStore } from './install-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { useSettingsStore } from './settings-store.ts';

/** Desktop commands operate across active targets, including recovery after a first install failed. */
export function InstallRecovery({ failed, drift }: { failed: boolean; drift: boolean }) {
  const { replacing, retrying, error, retryError, replace, retry } = useDriftStore();
  const snapshot = useInstallStore((state) => state.snapshot);
  const pending = useSettingsStore((state) => state.pending);
  if (!snapshot?.installs || (!failed && !drift)) return null;
  const busy = !!snapshot.running || pending !== null || replacing || retrying;
  return <div className="grid gap-2 text-xs">
    <p className="m-0 text-(--muted-foreground)">Retry and Replace apply to all active targets.</p>
    <div className="flex flex-wrap gap-2">
      {failed && <Button {...kind('other')} data-retry-install aria-label="Retry installation in all active targets" disabled={busy} onClick={() => void retry()}>{retrying ? 'Retrying…' : 'Retry'}</Button>}
      {drift && <Button {...kind('other')} data-replace-drift aria-label="Replace Drift in all active targets" disabled={busy} onClick={() => void replace()}>{replacing ? 'Replacing…' : 'Replace Drift'}</Button>}
    </div>
    {(error || retryError) && <span role="alert">{error || retryError}</span>}
  </div>;
}

/** Current skill work and retained results, shared by Settings and the install overview. */
export function TargetProgress({ target, showProgress = true }: { target: TargetSnapshot; showProgress?: boolean }) {
  const snapshot = useInstallStore((state) => state.snapshot);
  const states = { pending: 'Waiting', checking: 'Checking', installing: 'Installing', installed: 'Installed', drift: 'Drift', blocked: 'Clash', missing: 'Missing', failed: 'Failed' };
  const blocked = target.skills.filter(({ state }) => state === 'blocked');
  const localClash = (name: string) => !!snapshot?.blocked.some(({ skill, paths }) => skill === name
    && paths.some(({ path }) => target.paths.some((folder) => path === `${folder}/${name}`)));
  const clashes = blocked.flatMap(({ name }) => snapshot?.blocked.filter(({ skill }) => skill === name).flatMap(({ paths }) => paths)
    .filter(({ path, place }) => target.paths.some((folder) => path === `${folder}/${name}`) || (target.kind === 'claude' && place === 'agents'))
    .map(({ path }) => path) ?? []);
  const drift = target.skills.some(({ state }) => state === 'drift') || !!snapshot?.drift.some(({ skill, paths }) =>
    paths.some(({ path }) => target.paths.some((folder) => path === `${folder}/${skill}`)));
  const failed = !!target.error || target.skills.some(({ state }) => state === 'failed');
  const successful = target.skills.filter(({ state }) => state === 'installed').length;
  const status = target.running ? target.operation === 'check' ? 'Checking' : target.operation === 'replace' ? 'Replacing Drift' : 'Installing'
    : failed ? 'Install failed' : blocked.length ? blocked.some(({ name }) => localClash(name)) ? 'Clash' : 'Blocked by source Clash' : drift ? 'Drift detected'
    : !target.active && target.kind !== 'claude' && target.release ? 'Copies retained; future installs off'
    : target.active && target.skills.length > 0 && successful === target.skills.length ? 'Installed' : 'Not installed';
  return <div className="grid gap-2 text-xs [overflow-wrap:anywhere]">
    <p className="m-0" role={showProgress ? 'status' : undefined}>{target.release ? `Release ${target.release}` : 'No Release installed'} · {status}</p>
    {showProgress && target.operation && target.operation !== 'check' && <progress className="w-full" aria-label={`Skills installed in ${target.path}`} value={successful} max={target.skills.length || 1} />}
    {target.skills.length > 0 && <ul className="m-0 list-none p-0">{target.skills.map(({ name, state }) => <li key={name}>{name}: {state === 'blocked' && !localClash(name) ? 'Blocked by source Clash' : states[state]}</li>)}</ul>}
    {!!target.replaced?.length && <p className="m-0">Replaced Drift: {target.replaced.join(', ')}</p>}
    {target.error && <p className="m-0">{target.path}: {target.error}. Check access to the reported paths, then Retry.</p>}
    {clashes.map((path) => <p className="m-0" key={path}>Clash at {path}. Lar Factory does not own this path. Rename or remove it, then Retry.</p>)}
    <InstallRecovery failed={failed || blocked.length > 0} drift={drift} />
  </div>;
}

