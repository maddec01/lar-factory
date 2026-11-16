// The sample board's fixture, read once a run so the board and the fake tracker it reads from see the same items:
// `BOARD_DATA_FILE`, with the sample's scenarios in place when `BOARD_SAMPLE_SCENARIOS` is set (`pnpm run sample`).

import type { BoardData } from '@lar-factory/shared';
import { readFileSync } from 'node:fs';

import { withScenarios } from './sample-scenarios.ts';

let read: BoardData | null | undefined;

/** The fixture `BOARD_DATA_FILE` names, with the scenarios when asked; null with none. */
export function sampleFixture(): BoardData | null {
    if (read !== undefined) return read;

    const file = process.env.BOARD_DATA_FILE;
    const data = file ? (JSON.parse(readFileSync(file, 'utf8')) as BoardData) : null;

    read = data && process.env.BOARD_SAMPLE_SCENARIOS ? withScenarios(data) : data;

    return read;
}
