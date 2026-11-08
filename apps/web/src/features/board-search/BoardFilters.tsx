// The board search's kind icon and token type, including the hue a kind gives the closed field.

import { type CommandPaletteToken } from '@lar-works/design-system';

import type { KindFilter } from '@/features/filters';
import { KIND_BADGES } from '@/features/items';
import { conceptIcons } from '@/ui/board';

export interface FilterToken extends CommandPaletteToken {
    /** A kind's hue, which colours the closed field's token. */
    hue?: number;
}

export function KindIcon({ choice }: { choice: KindFilter }) {
    const Icon = choice === 'no-kind' ? conceptIcons.noKind : KIND_BADGES[choice]!.icon;

    return <Icon aria-hidden="true" />;
}
