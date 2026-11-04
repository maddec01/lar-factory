// What the board search lists: groups of options in list order, each option doing its own thing when chosen, and the
// words that narrow them. A result contains every query word as a case-insensitive substring.

import type { ReactNode } from 'react';

export interface SearchOption {
  value: string;
  name: string;
  icon: ReactNode;
  /** Whether a filter's option is on; other options leave it out. */
  on?: boolean;
  select: () => void;
}

export interface SearchGroup {
  label: string;
  options: SearchOption[];
}

export function matchingGroups(groups: readonly SearchGroup[], query: string): SearchGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return groups
    .map(({ label, options }) => ({ label, options: options.filter(({ name }) => words.every((word) => name.toLowerCase().includes(word))) }))
    .filter(({ options }) => options.length);
}
