// Skill work and retained results, with recovery through the desktop-owned installer.
import type { TargetSnapshot } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useDriftStore } from '../notices/drift-store.ts';
import { useInstallStore } from './install-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

/** Current skill work and retained results, shared by Settings and the install overview. */
export function TargetProgress({ target, showProgress = true }: { target: TargetSnapshot; showProgress?: boolean }) {
  const { replacing, retrying, error, retryError, replace, retry } = useDriftStore();
  const snapshot = useInstallStore((state) => state.snapshot);
  const states = { pending: 'Waiting', checking: 'Checking', installing: 'Installing', installed: 'Installed', drift: 'Drift', blocked: 'Clash', missing: 'Missing', failed: 'Failed' };
  const blocked = target.skills.filter(({ state }) => state === 'blocked');
  const clashes = blocked.flatMap(({ name }) => {
    const paths = snapshot?.blocked.filter(({ skill }) => skill === name).flatMap(({ paths }) => paths)
      .filter(({ path }) => target.paths.some((folder) => path === `${folder}/${name}`)).map(({ path }) => path) ?? [];
    return paths.length ? paths : [`${target.path}/${name}`];
  });
  const drift = target.skills.some(({ state }) => state === 'drift');
  const failed = !!target.error || target.skills.some(({ state }) => state === 'failed');
  const successful = target.skills.filter(({ state }) => state === 'installed').length;
  const busy = !!snapshot?.running || replacing || retrying;
  const status = target.running ? target.operation === 'check' ? 'Checking' : target.operation === 'replace' ? 'Replacing Drift' : 'Installing'
    : failed ? 'Install failed' : blocked.length ? 'Clash' : drift ? 'Drift detected'
    : target.active && target.skills.length > 0 && successful === target.skills.length ? 'Installed' : 'Not installed';
  return <div className="grid gap-2 text-xs [overflow-wrap:anywhere]">
    <p className="m-0" role={showProgress ? 'status' : undefined}>{target.release ? `Release ${target.release}` : 'No Release installed'} · {status}</p>
    {showProgress && target.operation && target.operation !== 'check' && <progress className="w-full" aria-label={`Skills installed in ${target.path}`} value={successful} max={target.skills.length || 1} />}
    {target.skills.length > 0 && <ul className="m-0 list-none p-0">{target.skills.map(({ name, state }) => <li key={name}>{name}: {states[state]}</li>)}</ul>}
    {!!target.replaced?.length && <p className="m-0">Replaced Drift: {target.replaced.join(', ')}</p>}
    {target.error && <p className="m-0">{target.path}: {target.error}. Check access to this folder, then Retry.</p>}
    {clashes.map((path) => <p className="m-0" key={path}>Clash at {path}. Move that path away, then Retry.</p>)}
    {snapshot?.installs && (failed || blocked.length > 0 || drift) && <div className="flex flex-wrap gap-2">
      {(failed || blocked.length > 0) && <Button {...kind('other')} data-retry-install disabled={busy} onClick={() => void retry()}>{retrying ? 'Retrying…' : 'Retry'}</Button>}
      {drift && <Button {...kind('other')} disabled={busy} onClick={() => void replace()}>{replacing ? 'Replacing…' : 'Replace Drift'}</Button>}
      {(error || retryError) && <span role="alert">{error || retryError}</span>}
    </div>}
  </div>;
}

