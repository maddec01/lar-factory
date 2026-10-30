// The skill check the board server asks the board app's main process for before Start build, over the server's
// IPC channel. The main process runs every check one at a time, so two checks never write the same folders at once.

import { isRecord } from './is-record.ts';

/** Set to `1` in the board server's environment when its parent answers skill checks. */
export const SKILL_CHECK_ENV = 'BOARD_SKILL_CHECK';

/** What the User chose for Drift before Start build: overwrite it with the app's Release, or start with the skills as they are. */
export type DriftChoice = 'replace' | 'keep';

export const isDriftChoice = (value: unknown): value is DriftChoice => value === 'replace' || value === 'keep';

/**
 * What a skill check found: why Start build can't run, or null when it can. With `drift`, the skills that changed
 * since their Release, the build waits for the User's DriftChoice and `refusal` asks for it.
 */
export interface SkillCheckOutcome {
  refusal: string | null;
  drift?: string[];
}

/** The board server asks its parent to check the installed skills, with the User's choice once Drift asked for one. */
export interface SkillCheckRequest {
  type: 'check-skills';
  id: number;
  drift?: DriftChoice;
}

/** The parent's answer to the request with the same `id`. */
export interface SkillCheckAnswer extends SkillCheckOutcome {
  type: 'skills-checked';
  id: number;
}

export const isSkillCheckRequest = (message: unknown): message is SkillCheckRequest =>
  isRecord(message) && message.type === 'check-skills' && Number.isInteger(message.id) &&
  (message.drift === undefined || isDriftChoice(message.drift));

export const isSkillCheckAnswer = (message: unknown): message is SkillCheckAnswer =>
  isRecord(message) && message.type === 'skills-checked' && Number.isInteger(message.id) &&
  (message.refusal === null || typeof message.refusal === 'string') &&
  (message.drift === undefined || (Array.isArray(message.drift) && message.drift.every((skill) => typeof skill === 'string')));
