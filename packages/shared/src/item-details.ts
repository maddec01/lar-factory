// What the item dialog reads for one item when it opens: the text and people the board-wide read leaves out.
// The item's labels, parent, linked PRs and update time stay on the board's `Item`.

import type { IssueRef } from './model.ts';

/** How a body or comment is written: GitHub's are markdown, an Azure DevOps field is markdown or HTML. */
export type TextFormat = 'markdown' | 'html';

export interface ItemComment {
  id: string;
  author: string;
  createdAt: string;
  body: string;
  format: TextFormat;
}

export interface ItemDetails {
  /** The description; empty when there is none. */
  body: string;
  format: TextFormat;
  /** The person who opened it; null when the provider doesn't say. */
  author: string | null;
  assignees: string[];
  createdAt: string | null;
  /** GitHub's milestone; absent on Azure DevOps. */
  milestone?: string;
  /** Azure DevOps's iteration and area; absent on GitHub. */
  iteration?: string;
  area?: string;
  /** Its sub-issues or child work items. */
  subTickets: IssueRef[];
  /** The latest comments, newest first. */
  comments: ItemComment[];
  /** Whether older comments exist than the ones listed. */
  hasOlderComments: boolean;
  /** Where the next 10 older comments start; null when there are none. */
  olderCursor: string | null;
}
