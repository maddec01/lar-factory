import { boardApp, plural, type UpdateState } from '@lar-factory/shared';
import { ConfirmDialog } from '@lar-works/design-system';
import { useEffect } from 'react';

import { downloadPercent, resolveUpdateButtonAction, resolveUpdatePill, updateStatusText } from './UpdateButtonLogic';
import { useUpdateStore } from './UpdateStore';
import { ReleaseNotes, UpdatePill } from '@/ui/board';

/** Each Release's changes, newest Release first, with what the app left out. */
function Notes({ state }: { state: UpdateState }) {
    return (
        <ReleaseNotes
            releases={state.releaseNotes.map((note, index) => {
                const omitted = note.totalItems - note.items.length;

                return {
                    version: note.version,
                    title: index === 0 ? 'What’s changed' : `Changes in ${note.version}`,
                    items: note.items,
                    ...(omitted > 0 && { more: `${plural(omitted, 'more change')} in this release` }),
                };
            })}
            {...(state.omittedReleaseCount > 0 && {
                older: `${plural(state.omittedReleaseCount, 'older release')} not shown`,
            })}
        />
    );
}

/** The store owns confirmation so Settings and Board search use the same dialog. */
export function RestartConfirmation() {
    const { state, confirming, installing, pending, confirmInstall, cancelInstall } = useUpdateStore();

    if (!state || !confirming) return null;

    const version = state.downloadedVersion ?? state.availableVersion;

    return (
        <ConfirmDialog
            data-restart-confirm
            title={`Restart to install ${version}?`}
            consequence={`Lar Factory will restart to install ${version}.`}
            confirmLabel="Restart now"
            cancelLabel="Later"
            intent="default"
            busy={installing}
            confirmDisabled={pending || resolveUpdateButtonAction(state) !== 'install'}
            onConfirm={() => void confirmInstall()}
            onCancel={cancelInstall}
        />
    );
}

export function UpdateButton() {
    const { state, follow, installing, confirming, pending, run } = useUpdateStore();

    useEffect(follow, [follow]);

    const pill = resolveUpdatePill(state);

    if (!boardApp() || !state || pill === 'none') return null;

    const ready = pill === 'ready';
    const downloading = pill === 'downloading';
    const version = state.downloadedVersion ?? state.availableVersion;
    const label = installing
        ? `Installing ${version}…`
        : downloading
          ? `Downloading ${version} · ${downloadPercent(state)}%`
          : ready
            ? `Restart to install ${version}`
            : `Update to ${version}`;

    return (
        <UpdatePill
            status={downloading ? 'downloading' : ready ? 'downloaded' : 'available'}
            percent={downloadPercent(state)}
            label={label}
            heading={`Lar Factory ${version}`}
            detail={`${updateStatusText(state)} You have ${state.currentVersion}.`}
            notes={state.releaseNotes.length > 0 && <Notes state={state} />}
            actionLabel={installing ? 'Installing…' : ready ? 'Restart now' : 'Download'}
            disabled={installing || confirming || pending || resolveUpdateButtonAction(state) === 'none'}
            onRun={() => void run()}
        />
    );
}
