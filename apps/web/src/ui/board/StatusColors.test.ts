// The board shows a status only in a state's colour (the design system's one state map): no glyph, slice, attention
// light or board role carries a sixth status colour, and the violet review role stays the Review stage's identity.
import { statusStateColors } from '@lar-works/design-system';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { attentionToneState, boardStatusState, sliceProgressState, stageColor, statusColor } from './StatusColors';

const stateColors = new Set<string>(Object.values(statusStateColors));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

it('every board status is drawn in its state colour', () => {
    for (const [status, colour] of Object.entries(statusColor)) {
        expect(stateColors.has(colour), `${status}: ${colour}`).toBe(true);
        expect(colour).toBe(statusStateColors[boardStatusState[status as keyof typeof boardStatusState]]);
    }
});

it('slices and attention lights map through a state', () => {
    for (const state of [...Object.values(sliceProgressState), ...Object.values(attentionToneState)])
        expect(Object.keys(statusStateColors)).toContain(state);
    expect(sliceProgressState.blocked).toBe('waiting');
    expect(sliceProgressState.waiting).toBe('off');
    expect(attentionToneState.blocked).toBe('waiting');
});

it('the stage bar differs from the status only in the Review stage', () => {
    for (const [status, colour] of Object.entries(stageColor))
        expect(colour).toBe(status === 'Review' ? 'var(--color-board-review)' : statusColor[status as 'Done']);
});

it('each board status role aliases a state colour', () => {
    const tokens = strip(readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8'));
    const roles = Object.fromEntries(
        [...tokens.matchAll(/(--color-board-(?:you|active|done|idle))\s*:\s*([^;]+);/g)].map(([, name, value]) => [
            name,
            value!.trim(),
        ]),
    );

    expect(roles).toEqual({
        '--color-board-you': statusStateColors.waiting,
        '--color-board-active': statusStateColors.active,
        '--color-board-done': statusStateColors.ready,
        '--color-board-idle': statusStateColors.off,
    });
});
