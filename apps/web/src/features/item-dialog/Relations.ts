// Whether the item dialog has a sidebar, and the work records the item's record waits on, which the sidebar lists.

import type { IssueRef, Item } from '@lar-factory/shared';

import { dependenciesOf } from '@/features/items';
import type { ItemDetailsRead } from '@/services/items/items.hooks';

/** The work records the item's record waits on, as the board holds them. */
export const waitsOn = (item: Item) => item.blockers.filter((b) => b.workId);

/**
 * The sub-tickets the sidebar lists: those the progress panel's slice chips don't already show. A sprint's children keep
 * their full list, as the sprint count reads it.
 */
export const sidebarSubTickets = (item: Item, subTickets: IssueRef[]): IssueRef[] =>
    item.currentSprint ? subTickets : subTickets.filter((s) => !item.slices.some((slice) => slice.number === s.number));

/** Whether the sidebar has anything: work it waits on, Dependencies, pull requests, or sub-tickets beyond the slices (as many as the board counts while the details load). */
export const hasRelations = (item: Item, read: ItemDetailsRead): boolean =>
    item.kind === 'build' ||
    item.linkedPrs.length > 0 ||
    waitsOn(item).length > 0 ||
    dependenciesOf(item).length > 0 ||
    (read.state === 'loaded'
        ? sidebarSubTickets(item, read.details.subTickets).length > 0 ||
          Boolean(
              read.details.attachments?.length ||
              read.details.related?.length ||
              read.details.blockers?.length ||
              read.details.relationsError,
          )
        : read.state === 'loading' && item.subIssues.total > item.slices.length);
