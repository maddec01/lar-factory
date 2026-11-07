// The Ready to build header's Auto-build switch: this Mac's choice to have the board start eligible Ready builds by itself.
// Its tooltip says how many builds would start now, and a hold shows beside it. Sample mode has no Auto-build, so the
// switch shows off and disabled there.

import type { AutoBuildPass } from '@lar-factory/shared';
import { HeaderSwitch } from '@lar-works/design-system';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { showToast } from '@/features/notices';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { Switch } from '@/shared/settings/SettingControls';

/** How many builds a pass would start now. */
function wouldStart(pass: AutoBuildPass | undefined): string {
    const n = pass?.wouldStart ?? 0;

    return n === 0
        ? 'No builds would start now.'
        : n === 1
          ? '1 build would start now.'
          : `${n} builds would start now.`;
}

export function AutoBuildSwitch() {
    const state = useBoardStore((s) => s.data.autoBuild);
    const pass = useBoardStore((s) => s.data.autoBuildPass);
    const [saving, setSaving] = useState<boolean | null>(null);

    const save = async (on: boolean) => {
        setSaving(on);

        const result = await postAction('/api/auto-build', { on });

        flushSync(() => {
            receive(result);
            setSaving(null);

            if (result.error)
                showToast({
                    slot: 'auto-build',
                    failed: true,
                    what: 'Auto-build',
                    body: (
                        <>
                            <b>Auto-build</b> {result.error}
                        </>
                    ),
                });
        });
    };

    const why = !state
        ? 'Disabled in sample mode'
        : state.problem
          ? `${state.problem} Turning it on replaces the file.`
          : wouldStart(pass);
    const hold = state?.on && pass?.hold;

    return (
        <HeaderSwitch
            label="Auto-build"
            title={why}
            hold={hold || undefined}
            control={
                <Switch
                    label="Auto-build"
                    on={saving ?? state?.on ?? false}
                    disabled={!state}
                    busy={saving !== null}
                    onChange={(on) => void save(on)}
                />
            }
        />
    );
}
