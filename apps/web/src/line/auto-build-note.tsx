// A Ready row's note from Auto-build: why its automatic start failed, which pauses Auto-build on it until a Start build
// on it succeeds or a new gate passes, or, with the switch on, that it waits for its concept's Refinement.

import type { BoardData, Item } from '@lar-factory/shared';

export function AutoBuildNote({ item, data }: { item: Item; data: BoardData }) {
    const pass = data.autoBuildPass;
    const paused = pass?.paused[item.id];
    if (paused)
        return (
            <p className="start" data-auto-build-paused={item.id}>
                <span className="action-error" role="alert">
                    Auto-build paused: {paused}
                </span>
            </p>
        );
    if (data.autoBuild?.on && pass?.waitsForRefinement.includes(item.id))
        return (
            <p className="start" data-auto-build-waits={item.id}>
                Auto-build waits for Refinement
            </p>
        );
    return null;
}
