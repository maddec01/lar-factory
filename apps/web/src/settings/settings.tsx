// The header's Settings button and its dialog, shown only in the board app: a tick box per Claude
// profile, which links the app's skills and checklists into it or removes them at once, and the
// update channel with what the updater last found on it.

import { Dialog } from '@base-ui/react/dialog';
import { boardApp, type UpdateChannel, type UpdateState } from '@mux-factory/shared';
import { profilePath, useSettingsStore } from './settings-store.ts';
import { useUpdateStore } from '../updates/update-store.ts';

const CHANNELS: { channel: UpdateChannel; label: string }[] = [
  { channel: 'nightly', label: 'Nightly' },
  { channel: 'latest', label: 'Latest' },
];

/** What the updater last found, in words. */
function updateStatusText(state: UpdateState): string {
  // A failed download or install keeps its update available or downloaded, with the error.
  if ((state.errorContext === 'download' || state.errorContext === 'install') && state.message !== null) {
    const verb = state.errorContext === 'install' ? 'install' : 'download';
    return `Couldn't ${verb} ${state.downloadedVersion ?? state.availableVersion}: ${state.message}`;
  }
  switch (state.status) {
    case 'disabled': case 'error': return state.message ?? '';
    case 'idle': return '';
    case 'checking': return 'Checking for updates…';
    case 'up-to-date': return `Up to date on ${state.currentVersion}.`;
    case 'available': return `${state.availableVersion} is available.`;
    case 'downloading': return `Downloading ${state.availableVersion}…`;
    case 'downloaded': return `${state.downloadedVersion} is ready to install.`;
  }
}

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

function UpdateChannelChoice() {
  const { state, installing } = useUpdateStore();
  const { switchingTo, setChannel } = useSettingsStore();
  if (!state) return null;
  // Busy rather than disabled while the app switches, as the profile ticks, and while it downloads or
  // installs, when it would refuse a switch.
  const busy = switchingTo !== null || installing || state.status === 'downloading';
  const shown = switchingTo ?? state.channel;
  return (
    <fieldset className="update-channel" aria-busy={busy}>
      <legend>Update channel</legend>
      <p className="form-hint">Nightly offers each Nightly Release, even one older than this version. Latest offers only Stable Releases.</p>
      <div className="choices">
        {CHANNELS.map(({ channel, label }) => (
          <label key={channel}>
            <input type="radio" name="update-channel" value={channel} checked={shown === channel} aria-disabled={busy}
              onChange={() => busy || void setChannel(channel)} />
            {' '}{label}
          </label>
        ))}
      </div>
      <p className="form-hint" id="update-channel-status" role="status" aria-live="polite">{updateStatusText(state)}</p>
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
          <UpdateChannelChoice />
          <Result />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
