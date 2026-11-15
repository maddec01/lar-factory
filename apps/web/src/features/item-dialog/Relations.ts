// Whether the item dialog has a sidebar, and the work records the item's record waits on, which the sidebar lists.

import type { IssueRef, Item } from '@lar-factory/shared';

import { isGroupParent } from './group-parent';
import { dependenciesOf } from '@/features/items';
import { partsOf } from '@/features/line';
import type { ItemDetailsRead } from '@/services/items/items.hooks';

/** Whether the sidebar lists pull requests: the item has one, or it is a build, which says "No pull request yet" until
 *  it has. */
export const showsPullRequests = (item: Item, group: boolean): boolean =>
    item.linkedPrs.length > 0 || (item.kind === 'build' && !group);

/** The work records the item's record waits on, as the board holds them. */
export const waitsOn = (item: Item) => item.blockers.filter((b) => b.workId);

/**
 * The sub-tickets the sidebar lists: those the progress panel's slice chips don't already show. A sprint's children keep
 * their full list, as the sprint count reads it.
 */
export const sidebarSubTickets = (item: Item, subTickets: IssueRef[]): IssueRef[] =>
    item.currentSprint ? subTickets : subTickets.filter((s) => !item.slices.some((slice) => slice.number === s.number));

/** Whether the sidebar has anything: work it waits on, Dependencies, pull requests (showsPullRequests), or sub-tickets beyond the slices (as many as the board counts while the details load). */
export const hasRelations = (item: Item, read: ItemDetailsRead, group = false): boolean =>
    showsPullRequests(item, group) ||
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

/** A group whose only parts are its tracker's sub-tickets (such as Azure tasks): its Parts section counts and lists them,
 *  so the sidebar doesn't. */
export const subTicketsInParts = (item: Item, items: readonly Item[]): boolean =>
    isGroupParent(item, items) && item.subIssues.total > 0 && !partsOf(item, items).length;
