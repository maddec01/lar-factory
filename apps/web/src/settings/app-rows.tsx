// The settings rows the board app's bridge answers: a switch per Install target, which installs the app's skills
// there or stops installing them, locked on for a target T3 Code needs, the update channel, and the version with what the updater last found
// and the update pill's step, Download or Restart to update, or else Check now. Each group's note says what the last
// call did.

import type { UpdateChannel } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { FormResult } from '../notices/form-result.tsx';
import { useUpdateStore } from '../updates/update-store.ts';
import { canCheckForUpdate, getUpdateDisabledReason, resolveUpdateButtonAction, resolveUpdatePill, updateStatusText } from '../updates/update-button-logic.ts';
import { SmallButton, Choice, Switch } from './controls.tsx';
import { type SettingsResult, useSettingsStore } from './settings-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

const CHANNELS: { value: UpdateChannel; label: string }[] = [
  { value: 'nightly', label: 'Nightly' },
  { value: 'latest', label: 'Latest' },
];

export function TargetSwitch({ path }: { path: string }) {
  const { targets, installs, installed, pending, setTick } = useSettingsStore();
  const target = targets?.find((candidate) => candidate.path === path);
  // Busy rather than disabled while a tick changes, so focus stays on the switch just pressed;
  // the store ignores a change that comes in meanwhile.
  return <Switch on={target?.active ?? false} label={path} disabled={!installs || !installed || (target?.locked ?? false)} busy={pending !== null}
    onChange={(on) => void setTick(path, on)} />;
}

/** What the group's last call did. It stays mounted, as a live region. */
function Result({ from }: { from: NonNullable<SettingsResult['from']> }) {
  const stored = useSettingsStore((state) => state.result);
  const result = stored.from === from ? stored : { text: '' } as SettingsResult;
  return (
    <FormResult id="settings-result" text={result.text} tone={result.tone}>
      {result.paths && <ul>{result.paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>}
    </FormResult>
  );
}

export function TargetsNote() {
  const { targets, installs, installed } = useSettingsStore();
  return (
    <div className="targets-note grid gap-2 px-1" aria-busy={targets === null}>
      {!installs && (
        <p className="m-0 text-xs text-(--muted-foreground)">This run of Lar Factory doesn't install skills, so you can't tick or untick a folder. Start it with --install-skills to change them.</p>
      )}
      {installs && !installed && (
        <p className="m-0 text-xs text-(--muted-foreground)">Lar Factory hasn't installed its skills yet, so you can't tick or untick a folder. It installs them when it starts. If the install failed, restart Lar Factory to try again.</p>
      )}
      {targets === null && <p className="m-0 text-xs text-(--muted-foreground)">Loading…</p>}
      <Result from="targets" />
    </div>
  );
}

export function UpdatesNote() {
  return <div className="px-1"><Result from="updates" /></div>;
}

export function ChannelChoice() {
  const { state, installing } = useUpdateStore();
  const { switchingTo, setChannel } = useSettingsStore();
  // Busy while the app switches, as the target ticks, and while it downloads or installs, when it would refuse a switch.
  const busy = !state || switchingTo !== null || installing || state.status === 'downloading';
  return <Choice label="Update channel" options={CHANNELS} value={switchingTo ?? state?.channel ?? null} busy={busy}
    onChange={(channel) => void setChannel(channel as UpdateChannel)} />;
}

export function UpdateStatus() {
  const state = useUpdateStore((s) => s.state);
  return <span id="update-status" role="status" aria-live="polite">{state ? updateStatusText(state) : ''}</span>;
}

function CheckNow() {
  const { state, check } = useUpdateStore();
  // While it checks or downloads, the reason is what it's doing.
  const reason = canCheckForUpdate(state) ? undefined : getUpdateDisabledReason(state) ?? (state ? updateStatusText(state) : 'Reading the updater…');
  return <SmallButton className="check-now" reason={reason} onClick={() => void check()}>Check now</SmallButton>;
}

/** The update pill's step while it has one, run as the pill runs it; otherwise Check now. */
export function UpdateAction() {
  const { state, installing, pending, run } = useUpdateStore();
  const pill = resolveUpdatePill(state);
  if (!state || (pill !== 'available' && pill !== 'ready')) return <CheckNow />;
  const busy = installing || pending || resolveUpdateButtonAction(state) === 'none';
  return (
    <Button {...kind('other')} className="update-action" disabled={busy} onClick={() => void run()}>
      {installing ? 'Installing…' : pill === 'ready' ? 'Restart to update' : 'Download'}
    </Button>
  );
}
