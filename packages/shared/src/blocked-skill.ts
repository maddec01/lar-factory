// How the board says what blocks a skill: a path Lar Factory didn't install that has the skill's name, in
// ~/.agents/skills, an Antigravity folder in ~/.gemini or a ticked Claude profile's skills/.

import type { BlockingPath } from './install-skills.ts';

/** Where a blocking path leaves its skill missing, by where the path is, and for a profile what else clears it. */
export function blockedPathNote(blocking: BlockingPath): string {
  switch (blocking.place) {
    case 'agents': return "the skill isn't installed";
    case 'antigravity': return "the skill isn't installed for Antigravity";
    case 'profile': return `the skill isn't linked into ~/${blocking.profile}; unticking the profile also clears it`;
  }
}

/**
 * `blocked by a path Lar Factory didn't install: <path> (<note>)`, with each path and its note, as parts in order:
 * the wording as strings, opening with one, and each path as `render` makes it, its text by default. Join the parts
 * for plain text.
 */
export function blockedBy<Path = string>(
  paths: readonly BlockingPath[],
  render: (path: string) => Path = (path) => path as Path,
): [string, ...(string | Path)[]] {
  return [
    `blocked by ${paths.length === 1 ? 'a path' : 'paths'} Lar Factory didn't install: `,
    ...paths.flatMap((blocking, index) => [...index > 0 ? [', '] : [], render(blocking.path), ` (${blockedPathNote(blocking)})`]),
  ];
}
