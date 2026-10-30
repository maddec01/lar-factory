// Asks the board app's main process to check the installed skills before Start build, installing a new Release and
// replacing Drift when the User chose to. The main process owns every check, so a check at app start and one for
// Start build never write the same folders at once.

import type { EventEmitter } from 'node:events';
import { SKILL_CHECK_ENV, isSkillCheckAnswer } from '@lar-factory/shared';
import type { DriftChoice, SkillCheckOutcome, SkillCheckRequest } from '@lar-factory/shared';

/** The parent end of the IPC channel, which Node's `process` is in a child started with one. */
export type ParentChannel = EventEmitter & { send?: (message: SkillCheckRequest) => boolean; connected?: boolean };

const NO_ANSWER: SkillCheckOutcome = {
  refusal: "The board app didn't answer the skill check, so the build can't start. Restart Lar Factory and try again.",
};

/**
 * A skill check through `parent`, with the User's Drift choice if they made one, which resolves with what the check
 * found. Undefined when `env` doesn't say the parent checks skills: without a bundle there is nothing to check against.
 */
export function parentSkillCheck(env: NodeJS.ProcessEnv = process.env, parent: ParentChannel = process):
  ((drift?: DriftChoice) => Promise<SkillCheckOutcome>) | undefined {
  if (env[SKILL_CHECK_ENV] !== '1' || !parent.send) return undefined;
  const send = parent.send.bind(parent);
  const waiting = new Map<number, (outcome: SkillCheckOutcome) => void>();
  let next = 0;
  parent.on('message', (message: unknown) => {
    if (!isSkillCheckAnswer(message)) return;
    const { refusal, drift } = message;
    waiting.get(message.id)?.({ refusal, ...drift && { drift } });
    waiting.delete(message.id);
  });
  parent.on('disconnect', () => {
    for (const answer of waiting.values()) answer(NO_ANSWER);
    waiting.clear();
  });
  return (drift) => new Promise((resolve) => {
    if (!parent.connected) return resolve(NO_ANSWER);
    const id = next++;
    waiting.set(id, resolve);
    send({ type: 'check-skills', id, ...drift && { drift } });
  });
}
