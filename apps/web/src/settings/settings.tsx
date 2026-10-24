// The sidebar's Settings button and its dialog, shown only in the board app: a tick box per Claude
// profile, which links the app's skills and checklists into it or removes them at once, and the
// update channel with what the updater last found on it.

import { Settings as SettingsIcon } from 'lucide-react';
import { boardApp, type UpdateChannel, type UpdateState } from '@mux-factory/shared';
import { Checkbox } from '@mux-factory/ui/checkbox';
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from '@mux-factory/ui/dialog';
import { Fieldset, FieldsetLegend } from '@mux-factory/ui/fieldset';
import { Label } from '@mux-factory/ui/label';
import { Radio, RadioGroup } from '@mux-factory/ui/radio-group';
import { profilePath, useSettingsStore } from './settings-store.ts';
import { useUpdateStore } from '../updates/update-store.ts';
import { FormResult } from '../notices/form-result.tsx';
import { SidebarIconButton } from '../sidebar/sidebar-icon-button.tsx';

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
    <Fieldset className="profiles" aria-busy={busy || profiles === null}>
      <FieldsetLegend>Claude profiles that get the skills</FieldsetLegend>
      {!installed && (
        <p className="form-hint">Mux Factory hasn't installed its skills in ~/.agents yet, so you can't tick or untick a profile. It installs them when it starts and ticks every profile it finds on that first install. If the install failed, restart Mux Factory to try again.</p>
      )}
      {profiles === null && <p className="form-hint">Loading…</p>}
      {profiles?.length === 0 && result.tone !== 'error' && <p className="form-hint">No Claude profiles found in ~.</p>}
      <div className="choices">
        {profiles?.map(({ name, ticked }) => (
          <Label key={name}>
            <Checkbox checked={ticked} disabled={!installed} aria-disabled={busy} onCheckedChange={(checked) => void setTick(name, checked)} />
            {profilePath(name)}
          </Label>
        ))}
      </div>
    </Fieldset>
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
    <Fieldset className="update-channel" aria-busy={busy}>
      <FieldsetLegend>Update channel</FieldsetLegend>
      <p className="form-hint">Nightly offers each Nightly Release, even one older than this version. Latest offers only Stable Releases.</p>
      <RadioGroup className="choices" name="update-channel" value={shown}
        onValueChange={(channel) => busy || void setChannel(channel as UpdateChannel)}>
        {CHANNELS.map(({ channel, label }) => (
          <Label key={channel}>
            <Radio value={channel} aria-disabled={busy} />
            {label}
          </Label>
        ))}
      </RadioGroup>
      <p className="form-hint" id="update-channel-status" role="status" aria-live="polite">{updateStatusText(state)}</p>
    </Fieldset>
  );
}

function Result() {
  const result = useSettingsStore((state) => state.result);
  return (
    <FormResult id="settings-result" text={result.text} tone={result.tone}>
      {result.paths && <ul>{result.paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>}
    </FormResult>
  );
}

export function Settings() {
  const { open, setOpen } = useSettingsStore();
  if (!boardApp()) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <SidebarIconButton label="Settings" className="open-settings" render={<DialogTrigger />}><SettingsIcon /></SidebarIconButton>
      <DialogPopup id="settings-dialog">
        <DialogHeader>
          <DialogTitle id="settings-heading">Settings</DialogTitle>
          <DialogDescription>Mux Factory links its skills and copies its checklists into each ticked profile.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Profiles />
          <UpdateChannelChoice />
          <Result />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
