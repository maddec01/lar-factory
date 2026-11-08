// Settings › General: this Mac's choice for an item's shaping threads after Start build. The choices stay available
// when the setting can't be read, as saving one replaces the file.

import type { ShapingThreadCleanup, ShapingThreadCleanupState } from '@lar-factory/shared';
import { Alert, Stack } from '@lar-works/design-system';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { postAction, receive } from '@/services/board/board.service';
import { Choice } from '@/shared/settings/SettingControls';

const CHOICES: { value: ShapingThreadCleanup; label: string }[] = [
    { value: 'keep', label: 'Keep' },
    { value: 'settle', label: 'Mark as finished' },
    { value: 'archive', label: 'Archive' },
    { value: 'delete', label: 'Delete' },
];

/** The saved choice, or an explicit missing/unreadable state; a new choice can replace an unreadable file. */
export function ShapingThreadCleanupSetting({ state }: { state: ShapingThreadCleanupState | undefined }) {
    const [saving, setSaving] = useState<ShapingThreadCleanup | null>(null);
    const [error, setError] = useState<string | null>(null);

    const save = async (choice: ShapingThreadCleanup) => {
        setSaving(choice);
        setError(null);

        const result = await postAction('/api/shaping-thread-cleanup', { choice });

        flushSync(() => {
            receive(result);
            setSaving(null);
            setError(result.error);
        });
    };

    return (
        <Stack space="related" data-shaping-thread-cleanup>
            <Choice
                label="Shaping threads when a build starts"
                options={CHOICES}
                value={saving ?? (state && 'choice' in state ? state.choice : null)}
                placeholder={state ? 'Not available' : 'Not reported'}
                busy={saving !== null}
                onChange={(choice) => void save(choice as ShapingThreadCleanup)}
            />
            {state && 'problem' in state && (
                <Alert size="sm" tone="danger">
                    {state.problem} Saving a choice replaces the file.
                </Alert>
            )}
            {error && (
                <Alert size="sm" tone="danger">
                    {error}
                </Alert>
            )}
        </Stack>
    );
}
