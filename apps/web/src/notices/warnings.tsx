import { T3AvailabilityWarning } from './t3-availability-warning.tsx';
// Connection problems stay in a collapsed inline banner. Skill maintenance lives in Settings.

import { failedCheck } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { CLIENT_ERROR, useDismissStore } from './dismiss-store.ts';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useSettingsStore } from '../settings/settings-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { Warning } from './warning.tsx';
import { ItemSourceWarning } from './item-source-warning.tsx';
import { AzWarning, CommandWarning, GhWarning, T3NotRunningWarning } from './tool-notices.tsx';

export function Warnings() {
  const data = useBoardStore((state) => state.data);
  const clientError = useBoardStore((state) => state.clientError);
  const dismissed = useDismissStore((state) => state.dismissed);
  const localProblem = dismissed.has('local-work') ? undefined : data.localProblem;
  const t3 = failedCheck(data.tools, 't3');
  const gh = failedCheck(data.tools, 'gh');
  const az = failedCheck(data.tools, 'az');
  const keys = [
    ...localProblem ? ['local-work'] : [],
    ...Object.keys(data.startCheckFailures ?? {}).map((id) => `start-check-${id}`),
    ...clientError ? [CLIENT_ERROR] : [],
    ...t3?.result === 'not-running' ? ['t3'] : [],
    ...(['gh', 'git', 'jq', 'curl', 'az'] as const).filter((name) => failedCheck(data.tools, name)),
    ...data.t3Availability && data.t3Availability.availability !== 'available' ? [`t3-source:${data.t3Availability.availability}`] : [],
    ...(data.itemSourceProblems ?? []).filter((problem) => !(az && problem.fix === az.fix)).map((problem) => `item-source:${problem.repo.toLowerCase()}`),
  ].filter((key) => !dismissed.has(key));
  if (!keys.length) return null;
  return (
    <aside data-board-notices className="shrink-0 border-b bg-(--warning-surface) px-6 py-2 text-(--foreground)">
      <div className="flex items-start justify-between gap-3">
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer text-xs font-medium">{localProblem ?? (keys.length === 1 ? 'A connection needs attention' : `${keys.length} connections need attention`)}</summary>
          <div className="mt-2 max-h-48 overflow-auto">
      {localProblem && <Warning dismissKey="local-work" what="local work needs attention" title={localProblem}>
        Your last view is still shown.
      </Warning>}
      {Object.entries(data.startCheckFailures ?? {}).map(([id, title]) => (
        <Warning key={id} dismissKey={`start-check-${id}`} what="thread check failed" title={`Could not check whether the thread for ${title} still exists.`}>
          The item stays Started. The board will retry in 30 seconds.
        </Warning>
      ))}
      {clientError && (
        <Warning dismissKey={CLIENT_ERROR} what="can't reach the board server" title="Can't reach the board server.">
          {clientError} Showing the last data this page received.
        </Warning>
      )}
      {t3?.result === 'not-running' && <T3NotRunningWarning check={t3} />}
      {gh && <GhWarning check={gh} />}
      {(['git', 'jq', 'curl'] as const).map((name) => {
        const check = failedCheck(data.tools, name);
        return check && <CommandWarning key={name} name={name} check={check} />;
      })}
      {az && <AzWarning check={az} />}
      <T3AvailabilityWarning key={data.t3Availability?.availability} />
      {data.itemSourceProblems?.filter((p) => !(az && p.fix === az.fix))
        .map((p) => <ItemSourceWarning key={p.repo.toLowerCase()} {...p} repos={data.repos} />)}
          </div>
        </details>
        <Button {...kind('other')} onClick={() => { const settings = useSettingsStore.getState(); settings.setSection('diagnostics'); settings.setOpen(true); }}>Diagnostics</Button>
      </div>
    </aside>
  );
}
