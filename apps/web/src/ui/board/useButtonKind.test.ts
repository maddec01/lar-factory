import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vite-plus/test';

import { TintedActions } from './ButtonDensity';
import type { ButtonKind } from './ButtonKinds';
import { useButtonKind } from './useButtonKind';

// Renders each kind's variant as the hook gives it, inside a tinted surface or not.
function Kinds({ danger = false }: { danger?: boolean }) {
    const kindOf = useButtonKind();
    const kinds: ButtonKind[] = ['main', 'start', 'next', 'open', 'control', 'other'];

    return createElement(
        'p',
        null,
        danger ? kindOf('other', 'danger').variant : kinds.map((kind) => `${kind}=${kindOf(kind).variant}`).join(' '),
    );
}

const render = (tinted: boolean, danger = false) => {
    const kinds = createElement(Kinds, { danger });

    return renderToStaticMarkup(tinted ? createElement(TintedActions, null, kinds) : kinds).replace(/<\/?p>/g, '');
};

test('every action on a tinted surface takes the brand tint, so row and map-card actions look the same', () => {
    expect(render(true)).toBe('main=tinted start=tinted next=tinted open=tinted control=quiet other=tinted');
    expect(render(true, true), 'a destructive choice keeps its danger recipe').toBe('destructive-quiet');
});

test('off a tinted surface each kind keeps its own recipe', () => {
    expect(render(false)).toBe('main=primary start=tinted next=tinted open=secondary control=quiet other=secondary');
});
