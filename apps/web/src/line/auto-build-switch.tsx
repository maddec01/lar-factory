// The Ready to build header's Auto-build switch: this Mac's choice to have the board start eligible Ready builds by itself.
// Its tooltip says how many builds would start now, and a hold shows beside it. Sample mode has no Auto-build, so the
// switch shows off and disabled there.

import type { AutoBuildPass } from '@lar-factory/shared';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { showToast } from '../notices/toasts.tsx';
import { Switch } from '../settings/controls.tsx';

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
        <span
            className="auto-build inline-flex min-w-0 items-center gap-1.5 text-[11px] whitespace-nowrap text-(--muted-foreground)"
            title={why}
        >
            {hold && (
                <span className="min-w-0 truncate" title={hold} data-auto-build-hold>
                    {hold}
                </span>
            )}
            <span aria-hidden="true">Auto-build</span>
            <Switch
                label="Auto-build"
                on={saving ?? state?.on ?? false}
                disabled={!state}
                busy={saving !== null}
                onChange={(on) => void save(on)}
            />
        </span>
    );
}
