// What the item dialog reads for one item when it opens: its work record's own text and progress, and its ticket's text
// and people, which the board-wide read leaves out. The item's labels, parent, linked PRs, slices, blockers and update
// time stay on the board's `Item`.

import type { IssueRef } from './model.ts';

/** How a body or comment is written: GitHub's are markdown, an Azure DevOps field is markdown or HTML. */
export type TextFormat = 'markdown' | 'html';

/** The Azure DevOps fields a description is read from: Repro Steps when System.Description is empty. */
export type AzureBodyField = 'System.Description' | 'Microsoft.VSTS.TCM.ReproSteps';

/** A description to save, as markdown, on the item the board holds under `itemId`. */
export interface DescriptionSave {
  itemId: string;
  body: string;
  /** On Azure DevOps, the `bodyField` and `revision` its details gave; absent on GitHub. */
  bodyField?: AzureBodyField;
  revision?: number;
}

export interface ItemComment {
  id: string;
  author: string;
  createdAt: string;
  body: string;
  format: TextFormat;
}

/** A review round as the item dialog shows it: each reviewer's verdict and how many of its findings are still open. */
export interface RecordReviewRound {
  round: number;
  recordedAt: string;
  reviewers: { axis: string; verdict: string; findings: number; open: number }[];
}

/** The work record's own text and progress, which ticket edits never change. */
export interface RecordDetails {
  /** Which body the record holds: a concept's map, a decision's text, or any other record's brief. */
  bodyKind: 'map' | 'decision' | 'brief';
  /** That body's markdown; empty while none is written. */
  body: string;
  /** The markdown the work began with, such as the picked ticket's text then; empty when it began with none. */
  context: string;
  /** Where its build stands, as lar-build names the phase, or null before it starts. */
  buildPhase: string | null;
  /** The build's review rounds, oldest first. */
  reviewRounds: RecordReviewRound[];
}

export interface ItemDetails {
  /** The work record's text and progress; absent in sample mode and for an item with no record. */
  record?: RecordDetails;
  /** The ticket's description; empty when there is none. */
  body: string;
  format: TextFormat;
  /** On Azure DevOps, the field the description was read from, which a save writes back; absent on GitHub. */
  bodyField?: AzureBodyField;
  /** On Azure DevOps, the work item's revision as read; a save fails if someone changed it since. Absent on GitHub. */
  revision?: number;
  /** Additional type-specific description fields, each with its own format. */
  sections?: { title: string; body: string; format: TextFormat }[];
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
  /** Named Azure attachments open in Azure DevOps; their contents are never downloaded by the board. */
  attachments?: { name: string; url: string }[];
  related?: IssueRef[];
  blockers?: IssueRef[];
  /** A failed relations read leaves the main details intact. */
  relationsError?: string;
  /** The latest comments, newest first. */
  comments: ItemComment[];
  /** Whether older comments exist than the ones listed. */
  hasOlderComments: boolean;
  /** Where the next 10 older comments start; null when there are none. */
  olderCursor: string | null;
}

/** One page of older comments, newest first. */
export interface ItemCommentsPage {
  comments: ItemComment[];
  /** Where the next 10 older comments start; null when this page reached the oldest. */
  olderCursor: string | null;
}
