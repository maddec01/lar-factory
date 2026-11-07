// Settings › General: this Mac's choice for an item's shaping threads after Start build. The choices stay available
// when the setting can't be read, as saving one replaces the file.

import type { ShapingThreadCleanup, ShapingThreadCleanupState } from '@lar-factory/shared';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { postAction, receive } from '@/services/board/board.service';
import { Choice } from '@/shared/settings/SettingControls';

const CHOICES: { value: ShapingThreadCleanup; label: string }[] = [
    { value: 'keep', label: 'Keep' },
    { value: 'settle', label: 'Settle' },
    { value: 'archive', label: 'Archive' },
    { value: 'delete', label: 'Delete' },
];

/** The four choices, with none picked until the board has read the setting, which it never does in sample mode. */
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
        <div className="grid gap-2" data-shaping-thread-cleanup>
            <Choice
                label="Shaping threads after Start build"
                options={CHOICES}
                value={saving ?? (state && 'choice' in state ? state.choice : null)}
                busy={saving !== null}
                onChange={(choice) => void save(choice as ShapingThreadCleanup)}
            />
            {state && 'problem' in state && (
                <p className="m-0 text-xs text-(--error-foreground)" role="alert">
                    {state.problem} Saving a choice replaces the file.
                </p>
            )}
            {error && (
                <p className="m-0 text-xs text-(--error-foreground)" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
