// The title bar's update pill, a Port of T3 Code's update pill (apps/web/src/components/sidebar/SidebarUpdatePill.tsx
// at d53873b), drawn by the design system's UpdatePill as the board's other App controls are, tinted in every state,
// instead of as T3's pill. With no update it doesn't show; Settings › Updates checks. An available update reads "Update available", a download shows a progress
// ring with the percentage, and a downloaded update reads "Restart to update". Clicking the pill runs that step, with
// T3's toasts from the store; installing asks first in the app's native dialog, as T3 does. While the app installs,
// the pill reads "Installing…", disabled.
// Hovering the pill, or focusing it from the keyboard, opens T3's changelog (as SidebarUpdateReleaseNotes) below it,
// with the update's version, each Release's changes and the step's button. It closes 150 ms after the pointer leaves
// both, as T3's does, and on Escape. Focus stays on the pill, which runs the same step.
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import { boardApp, plural, type UpdateState } from '@lar-factory/shared';
import { useEffect } from 'react';

import { downloadPercent, resolveUpdateButtonAction, resolveUpdatePill, updateStatusText } from './UpdateButtonLogic';
import { useUpdateStore } from './UpdateStore';
import { ReleaseNotes, UpdateDownloading, UpdatePill } from '@/ui/board';

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

/** "Update available" or "Restart to update", with the changelog and the step's button. */
function NextStep({ state, ready }: { state: UpdateState; ready: boolean }) {
    const { installing, pending, run } = useUpdateStore();
    const disabled = installing || pending || resolveUpdateButtonAction(state) === 'none';

    return (
        <UpdatePill
            status={ready ? 'downloaded' : 'available'}
            label={installing ? 'Installing…' : ready ? 'Restart to update' : 'Update available'}
            heading={updateStatusText(state)}
            notes={state.releaseNotes.length > 0 && <Notes state={state} />}
            actionLabel={ready ? 'Restart now' : 'Download'}
            disabled={disabled}
            onRun={() => void run()}
        />
    );
}

export function UpdateButton() {
    const { state, follow } = useUpdateStore();

    useEffect(follow, [follow]);

    const pill = resolveUpdatePill(state);

    if (!boardApp() || !state || pill === 'none') return null;

    if (pill === 'downloading')
        return (
            <UpdateDownloading
                percent={downloadPercent(state)}
                text="Downloading"
                label={`Downloading ${state.availableVersion ?? 'the update'}`}
                tooltip={updateStatusText(state)}
            />
        );

    return <NextStep state={state} ready={pill === 'ready'} />;
}
