// Update on the launch-agent board: the button, in the header or on the banner when behind, the
// banner for each phase of an update, and the toast when one finished.

import type { BoardData, UpdateProgress } from '../model.ts';
import { UPDATE_HINTS, UPDATE_RESULT_MS } from '../update-view.ts';
import type { UpdateView } from '../update-view.ts';
import { useBoardStore } from './board-store.ts';
import { ClosableBanner } from './ClosableBanner.tsx';
import { CopyButton } from './CopyButton.tsx';
import { useDismissStore } from './dismiss-store.ts';
import { ToastView } from './Toasts.tsx';
import { updateBusy, useUpdateStore } from './update-store.ts';

const COPY_LABEL = 'Copy board update command';

/** Whether Update sits on the "Board update available" banner rather than in the header. */
function onBanner(data: BoardData, view: UpdateView | null): boolean {
  const update = data.codeUpdate;
  // While an update runs, its progress replaces the notice and the button returns to the title row.
  const running = data.update?.state === 'running' && view?.phase !== 'lost';
  return Boolean(update?.updatable) && (update?.behind ?? 0) > 0 && !running;
}

function UpdateButton() {
  const data = useBoardStore((state) => state.data);
  const { view, start } = useUpdateStore();
  const busy = updateBusy(data, view);
  return (
    <button type="button" className="copy" data-update aria-label={`${busy ? 'Updating' : 'Update'} the board and skills`}
      aria-disabled={busy || undefined} onClick={() => void start()}>{busy ? 'Updating…' : 'Update'}</button>
  );
}

/** Update in the header's actions, when it isn't on the banner. */
export function HeaderUpdateButton() {
  const data = useBoardStore((state) => state.data);
  const view = useUpdateStore((state) => state.view);
  return data.codeUpdate?.updatable && !onBanner(data, view) ? <UpdateButton /> : null;
}

/** What the update shows: this page's own failure, else the server's progress, unless it was closed or is old. */
type Shown =
  | { phase: 'lost' | 'refused'; view: UpdateView }
  | { phase: UpdateProgress['state']; progress: UpdateProgress; key: string };

function useShown(): Shown | null {
  const { data, now } = useBoardStore();
  const view = useUpdateStore((state) => state.view);
  const dismissed = useDismissStore((state) => state.dismissed);
  if (view?.phase === 'lost' && data.codeUpdate) return dismissed.has('lost') ? null : { phase: 'lost', view };
  if (view?.phase === 'refused' && !dismissed.has('refused')) return { phase: 'refused', view };
  const progress = data.update;
  if (!progress) return null;
  const key = `update-${progress.finishedAt}`;
  if (progress.state !== 'running' && dismissed.has(key)) return null;
  // A failure stays until it is closed or the next update replaces it; a success clears.
  const finishedAt = progress.finishedAt ? Date.parse(progress.finishedAt) : NaN;
  if (progress.state === 'done' && !(now - finishedAt <= UPDATE_RESULT_MS)) return null;
  return { phase: progress.state, progress, key };
}

function Steps({ progress }: { progress: UpdateProgress }) {
  return (
    <ol className="update-steps" aria-label="Update steps">
      {progress.finished.map((step) => <li className="finished" key={step}>{step}</li>)}
      {progress.current && <li className={progress.state === 'failed' ? 'failed' : 'current'} aria-current="step">{progress.current}</li>}
    </ol>
  );
}

function ProgressBanner() {
  const data = useBoardStore((state) => state.data);
  const shown = useShown();
  const update = data.codeUpdate;
  if (shown?.phase === 'lost' && update) {
    return (
      <ClosableBanner dismissKey="lost" what=": the board didn't restart">
        <strong>The board didn't restart.</strong> Check <code>{update.logs.board}</code> and <code>{update.logs.update}</code>, then
        run <code>{update.command}</code> in a terminal. <CopyButton text={update.command} label={COPY_LABEL} />
      </ClosableBanner>
    );
  }
  if (shown?.phase === 'refused' && shown.view.phase === 'refused') {
    return (
      <ClosableBanner dismissKey="refused" what=": the update didn't start">
        <strong>The update didn't start.</strong> {shown.view.message}
      </ClosableBanner>
    );
  }
  if (shown?.phase === 'running') {
    return <div className="banner update-progress" role="status"><strong>Updating the board and skills…</strong><Steps progress={shown.progress} /></div>;
  }
  if (shown?.phase !== 'failed') return null;
  const { progress, key } = shown;
  const step = progress.current && progress.current in UPDATE_HINTS ? progress.current : 'done';
  return (
    <ClosableBanner dismissKey={key} what=": update failed" className="banner update-progress">
      <strong>Update failed at {step}.</strong> {progress.error ?? ''}<Steps progress={progress} />
      {progress.logTail && <pre className="update-log">{progress.logTail}</pre>}
      <p className="update-hint">{UPDATE_HINTS[step]}{update && <> Full log: <code>{update.logs.update}</code></>}</p>
    </ClosableBanner>
  );
}

/** The header's update banners: an update available, its progress or failure, and the update check. */
export function UpdateBanners() {
  const data = useBoardStore((state) => state.data);
  const view = useUpdateStore((state) => state.view);
  const update = data.codeUpdate;
  const behind = (update?.behind ?? 0) > 0;
  const banner = onBanner(data, view);
  return (
    <>
      {update && behind && (banner || !update.updatable) && (
        <div className="banner code-update" role="status">
          <strong>Board update available.</strong>{' '}
          {update.updatable ? <UpdateButton /> : <>Run <code>{update.command}</code> <CopyButton text={update.command} label={COPY_LABEL} /></>}
        </div>
      )}
      <ProgressBanner />
      {update && (update.error || update.behind === null) && (
        <div className="banner" role="status">
          <strong>{update.error ? 'Board update check failed.' : 'Checking for board updates…'}</strong>{update.error && ` ${update.error}`}
        </div>
      )}
    </>
  );
}

/** The toast for an update that finished in the last 15 minutes, until it clears or is closed. */
export function UpdateToast() {
  const shown = useShown();
  if (shown?.phase !== 'done') return null;
  const { progress, key } = shown;
  const result = progress.finished.includes('restart') && progress.revision
    ? <>The board now runs <code>{progress.revision.slice(0, 7)}</code>, with the skills and checklists from main.</>
    : 'The board was already current; the skills and checklists are updated from main.';
  return (
    <ToastView key={key} what="update finished" onClose={() => useDismissStore.getState().dismiss(key)}>
      <strong>Update finished.</strong> {result}
    </ToastView>
  );
}
