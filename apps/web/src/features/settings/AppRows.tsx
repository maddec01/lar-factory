// The settings rows the board app's bridge answers: the update channel, and the version with what the updater last
// found and the update pill's step, Download or Restart to update, or else Check now. The group's note says what the
// last channel switch did.

import type { UpdateChannel } from '@lar-factory/shared';
import { Button, FormResult, SettingsNote } from '@lar-works/design-system';

import { useSettingsStore } from './SettingsStore';
import {
    canCheckForUpdate,
    getUpdateDisabledReason,
    resolveUpdateButtonAction,
    resolveUpdatePill,
    updateStatusText,
    useUpdateStore,
} from '@/features/updates';
import { SmallButton, Choice } from '@/shared/settings/SettingControls';
import { buttonKind } from '@/ui/board';

const CHANNELS: { value: UpdateChannel; label: string }[] = [
    { value: 'nightly', label: 'Nightly' },
    { value: 'latest', label: 'Latest' },
];

export function UpdatesNote() {
    const result = useSettingsStore((state) => state.result);

    return (
        <SettingsNote>
            <FormResult id="settings-result" text={result.text} tone={result.tone} />
        </SettingsNote>
    );
}

export function ChannelChoice() {
    const { state, installing, pending, confirming } = useUpdateStore();
    const { switchingTo, setChannel } = useSettingsStore();
    // Busy while the app switches, and while it downloads or installs, when it would refuse a switch.
    const busy =
        !state || switchingTo !== null || installing || pending || confirming || state.status === 'downloading';

    return (
        <Choice
            label="Update channel"
            options={CHANNELS}
            value={switchingTo ?? state?.channel ?? null}
            busy={busy}
            onChange={(channel) => void setChannel(channel as UpdateChannel)}
        />
    );
}

export function UpdateStatus() {
    const state = useUpdateStore((s) => s.state);

    return (
        <span id="update-status" role="status" aria-live="polite">
            {state ? updateStatusText(state) : ''}
        </span>
    );
}

function CheckNow() {
    const { state, check, installing, pending, confirming } = useUpdateStore();
    // While it checks or downloads, the reason is what it's doing.
    const reason = canCheckForUpdate(state)
        ? undefined
        : (getUpdateDisabledReason(state) ?? (state ? updateStatusText(state) : 'Reading the updater…'));

    return (
        <SmallButton
            data-check-now
            reason={pending || installing || confirming ? 'An update action is in progress.' : reason}
            onClick={() => void check()}
        >
            Check now
        </SmallButton>
    );
}

/** The update pill's step while it has one, run as the pill runs it; otherwise Check now. */
export function UpdateAction() {
    const { state, installing, pending, confirming, run } = useUpdateStore();
    const pill = resolveUpdatePill(state);

    if (!state || (pill !== 'available' && pill !== 'ready')) return <CheckNow />;

    const busy = installing || pending || confirming || resolveUpdateButtonAction(state) === 'none';

    return (
        <Button {...buttonKind('other', { size: 'md' })} data-update-action disabled={busy} onClick={() => void run()}>
            {installing ? 'Installing…' : pill === 'ready' ? 'Restart to update' : 'Download'}
        </Button>
    );
}
