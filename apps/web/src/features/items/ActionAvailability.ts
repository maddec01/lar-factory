// Whether an item's write controls are disabled in sample mode or held by an action already in flight.

import type { BoardData } from '@lar-factory/shared';

import type { ItemAction } from './ActionStore';

/** Board writes are off in sample mode, so its buttons are too; an action in flight holds them. */
export function writeState(
    data: BoardData,
    action?: ItemAction,
): { disabled?: true; title?: string; 'aria-disabled'?: true } {
    if (data.capture?.enabled === false) return { disabled: true, title: 'Disabled in sample mode' };

    return action?.phase === 'pending' ? { 'aria-disabled': true } : {};
}
