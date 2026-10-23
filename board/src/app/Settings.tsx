// The header's Settings button and its dialog, shown only in the board app: a tick box per Claude
// profile, which links the app's skills and checklists into it or removes them at once.

import { Dialog } from '@base-ui/react/dialog';
import { boardApp } from './board-app.ts';
import { profilePath, useSettingsStore } from './settings-store.ts';

function Profiles() {
  const { profiles, installed, pending, result, setTick } = useSettingsStore();
  // Busy rather than disabled while a tick changes, so focus stays on the box just pressed;
  // the store ignores a change that comes in meanwhile.
  const busy = pending !== null;
  return (
    <fieldset className="profiles" aria-busy={busy || profiles === null}>
      <legend>Claude profiles that get the skills</legend>
      {!installed && (
        <p className="form-hint">Mux Factory hasn't installed its skills in ~/.agents yet, so you can't tick or untick a profile. It installs them when it starts and ticks every profile it finds on that first install. If the install failed, restart Mux Factory to try again.</p>
      )}
      {profiles === null && <p className="form-hint">Loading…</p>}
      {profiles?.length === 0 && result.tone !== 'error' && <p className="form-hint">No Claude profiles found in ~.</p>}
      <div className="choices">
        {profiles?.map(({ name, ticked }) => (
          <label key={name}>
            <input type="checkbox" checked={ticked} disabled={!installed} aria-disabled={busy} onChange={(event) => void setTick(name, event.target.checked)} />
            {' '}{profilePath(name)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Result() {
  const result = useSettingsStore((state) => state.result);
  return (
    <div id="settings-result" role="status" aria-live="polite" aria-atomic="true" data-tone={result.tone}>
      {result.text}
      {result.paths && <ul>{result.paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>}
    </div>
  );
}

export function Settings() {
  const { open, setOpen } = useSettingsStore();
  if (!boardApp()) return null;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="copy open-settings">Settings</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup id="settings-dialog">
          <div className="form-heading">
            <Dialog.Title id="settings-heading">Settings</Dialog.Title>
            <Dialog.Close className="copy">Close</Dialog.Close>
          </div>
          <p className="form-hint">Mux Factory links its skills and copies its checklists into each ticked profile.</p>
          <Profiles />
          <Result />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
