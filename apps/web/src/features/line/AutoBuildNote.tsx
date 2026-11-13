// A Ready row's note from Auto-build: why its automatic start failed, which pauses Auto-build on it until a Start build
// on it succeeds or a new gate passes, or, with the switch on, that it waits for its concept's Refinement.

import { staleGateReason, type BoardData, type Item } from '@lar-factory/shared';

import { ActionError, StartLine } from '@/ui/board';

export function AutoBuildNote({ item, data }: { item: Item; data: BoardData }) {
    const gate = staleGateReason(item);

    if (gate) return <StartLine data-stale-gate={item.id}>{gate}</StartLine>;

    const pass = data.autoBuildPass;
    const paused = pass?.paused[item.id];

    if (paused)
        return (
            <StartLine data-auto-build-paused={item.id}>
                <ActionError>Auto-build paused: {paused}</ActionError>
            </StartLine>
        );

    if (data.autoBuild?.on && pass?.waitsForRefinement.includes(item.id))
        return <StartLine data-auto-build-waits={item.id}>Auto-build waits for Refinement</StartLine>;

    return null;
}
