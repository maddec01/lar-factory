// The skill check the board server asks the board app's main process for before Start build, over the server's
// IPC channel. The main process runs every check one at a time, so two checks never write the same folders at once.

import { isRecord } from './is-record.ts';

/** Set to `1` in the board server's environment when its parent answers skill checks. */
export const SKILL_CHECK_ENV = 'BOARD_SKILL_CHECK';

/** The board server asks its parent to check and restore the installed skills. */
export interface SkillCheckRequest {
  type: 'check-skills';
  id: number;
}

/** The parent's answer to the request with the same `id`: why Start build can't run, or null when it can. */
export interface SkillCheckAnswer {
  type: 'skills-checked';
  id: number;
  refusal: string | null;
}

export const isSkillCheckRequest = (message: unknown): message is SkillCheckRequest =>
  isRecord(message) && message.type === 'check-skills' && Number.isInteger(message.id);

export const isSkillCheckAnswer = (message: unknown): message is SkillCheckAnswer =>
  isRecord(message) && message.type === 'skills-checked' && Number.isInteger(message.id) &&
  (message.refusal === null || typeof message.refusal === 'string');
