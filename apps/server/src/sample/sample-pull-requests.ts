import { refKey, type BoardData, type Item, type LinkedPr } from '@lar-factory/shared';

/**
 * The fixture's PRs on its ticket work, with their checks as read. The fake tracker holds no delivery evidence, so the
 * sample shows these as a PR read would, on any ticket that has none of its own.
 */
export function samplePullRequests(fixture: BoardData) {
    const prs = new Map<string, LinkedPr[]>(
        fixture.items
            .filter((item) => !item.recorded && item.number && item.linkedPrs.length)
            .map((item) => [refKey(item.repo, item.number).toLowerCase(), item.linkedPrs]),
    );

    return {
        project(item: Item): Item {
            const linked = item.linkedPrs.length ? undefined : prs.get(refKey(item.repo, item.number).toLowerCase());

            return linked ? { ...item, linkedPrs: structuredClone(linked) } : item;
        },
    };
}
