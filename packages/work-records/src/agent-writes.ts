import { applyAgentWrite } from './agent-apply.ts';
import { agentConceptWrites } from './agent-concept-writes.ts';
import type { WorkRecords } from './work-records.ts';

const active = ['kind', 'setAsideAt', 'finishedAt'];
const build = [...active, 'buildBranch'];
const review = [...build, 'pullRequest', 'body.brief', 'reviewRounds', 'runSettings'];

/** Command adapter: preserve each intent and let the strict store reject a race during reapplication. */
export function agentWrites(records: WorkRecords): WorkRecords {
    const apply = <T>(
        id: string,
        revision: number,
        fields: readonly string[],
        write: (latest: number) => T,
        entity: 'work' | 'dependency' = 'work',
    ): T => applyAgentWrite(records, [{ id, revision, fields, entity }], (latest) => write(latest(id, entity)));

    return {
        ...records,
        ...agentConceptWrites(records),
        completeCapture: (request, record, target) => {
            if (!target || records.captureSubmission(request)?.workId)
                return records.completeCapture(request, record, target);

            return apply(target.workId, target.revision, ['ticket', 'title', 'kind', 'body.brief', 'gate'], (r) =>
                records.completeCapture(request, record, { ...target, revision: r }),
            );
        },
        update: (id, rev, patch) =>
            apply(
                id,
                rev,
                [
                    ...active,
                    ...Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined),
                    ...(patch.kind ? ['kindAnswer', 'parentId', 'children', 'dependencies'] : []),
                ],
                (r) => records.update(id, r, patch),
            ),
        retitle: (id, rev, title) => apply(id, rev, ['title'], (r) => records.retitle(id, r, title)),
        recordKindAnswer: (id, rev, answer) =>
            apply(id, rev, ['kind', 'kindAnswer', 'ticket'], (r) => records.recordKindAnswer(id, r, answer)),
        attachTicket: (id, rev, ticket) => apply(id, rev, ['ticket'], (r) => records.attachTicket(id, r, ticket)),
        restore: (id, rev) => apply(id, rev, active, (r) => records.restore(id, r)),
        setNeedsYou: (id, rev, reason) =>
            apply(id, rev, [...active, 'needsYou'], (r) => records.setNeedsYou(id, r, reason)),
        clearNeedsYou: (id, rev) => apply(id, rev, [...active, 'needsYou'], (r) => records.clearNeedsYou(id, r)),
        waitForUser: (id, rev, reason) =>
            apply(id, rev, [...active, 'status', 'needsYou'], (r) => records.waitForUser(id, r, reason)),
        resumeFromUser: (id, rev, status) =>
            apply(id, rev, [...active, 'status', 'needsYou'], (r) => records.resumeFromUser(id, r, status)),
        snapshotSkills: (id, rev, skills) =>
            apply(id, rev, [...build, 'skills'], (r) => records.snapshotSkills(id, r, skills)),
        setParent: (id, rev, parent) =>
            apply(id, rev, [...active, 'parentId', 'dependencies'], (r) => records.setParent(id, r, parent)),
        clearParent: (id, rev) =>
            apply(id, rev, [...active, 'parentId', 'dependencies'], (r) => records.clearParent(id, r)),
        addBlocker: (id, rev, blocker) =>
            apply(id, rev, [...active, 'blockers'], (r) => records.addBlocker(id, r, blocker)),
        removeBlocker: (id, rev, blocker) =>
            apply(id, rev, [...active, 'blockers'], (r) => records.removeBlocker(id, r, blocker)),
        createPart: (part) =>
            apply(part.parentId, part.parentRevision, [...active, 'children'], (r) =>
                records.createPart({ ...part, parentRevision: r }),
            ),
        setBody: (id, rev, body, text) =>
            apply(
                id,
                rev,
                [
                    ...active,
                    `body.${body}`,
                    ...(body === 'map' ? ['children', 'decisionAnswers'] : []),
                    ...(body === 'answer' ? ['answerState', 'parentId'] : []),
                    ...(body === 'domain-drafts' ? ['parentId'] : []),
                ],
                (r) => records.setBody(id, r, body, text),
            ),
        setBuildPhase: (id, rev, phase) =>
            apply(id, rev, [...build, 'buildPhase'], (r) => records.setBuildPhase(id, r, phase)),
        setPullRequest: (id, rev, pr) =>
            apply(id, rev, [...build, 'pullRequest', 'observations.pr'], (r) => records.setPullRequest(id, r, pr)),
        recordReviewRound: (id, rev, round) => apply(id, rev, review, (r) => records.recordReviewRound(id, r, round)),
        setFindingDisposition: (id, rev, ref, disposition, reason) =>
            apply(id, rev, review, (r) => records.setFindingDisposition(id, r, ref, disposition, reason)),
        observe: (id, rev, observation) =>
            apply(
                id,
                rev,
                [
                    observation.of === 'pr' ? 'pullRequest' : 'ticket',
                    `observations.${observation.of}`,
                    ...(observation.state === 'merged' ? ['finishedAt'] : []),
                ],
                (r) => records.observe(id, r, observation),
            ),
        recordReadFailure: (id, rev, of, failure) =>
            apply(id, rev, [of === 'pr' ? 'pullRequest' : 'ticket', `observations.${of}`], (r) =>
                records.recordReadFailure(id, r, of, failure),
            ),
        confirmThreadDeleted: (id, rev, thread) =>
            apply(id, rev, [`threads.${thread}`], (r) => records.confirmThreadDeleted(id, r, thread)),
        setBuildBranch: (id, rev, branch) => apply(id, rev, [...build], (r) => records.setBuildBranch(id, r, branch)),
        invalidateGate: (id, rev) =>
            apply(id, rev, [...active, 'body.brief', 'gate'], (r) => records.invalidateGate(id, r)),
        resetBuild: (id, rev) =>
            apply(id, rev, [...build, 'buildPhase', 'children', 'dependencies', 'blockers'], (r) =>
                records.resetBuild(id, r),
            ),
        addThread: (id, rev, thread, purpose) =>
            apply(id, rev, [...active, `threads.${thread}`], (r) => records.addThread(id, r, thread, purpose)),
        recordLaunchIntent: (id, rev, purpose, options, cleanup) =>
            apply(id, rev, [...build, 'intents', 'threads'], (r) =>
                records.recordLaunchIntent(id, r, purpose, options, cleanup),
            ),
        resolveLaunchIntent: (id, rev, intent, outcome) =>
            apply(
                id,
                rev,
                [
                    ...build,
                    `intents.${intent}`,
                    'status',
                    'needsYou',
                    'needsYouCauses',
                    'buildPhase',
                    'children',
                    'dependencies',
                ],
                (r) => records.resolveLaunchIntent(id, r, intent, outcome),
            ),
        recordFinished: (id, rev) =>
            apply(id, rev, [...active, 'parentId', 'answerState', 'body.domain-drafts'], (r) =>
                records.recordFinished(id, r),
            ),
        setFogGone: (id, rev, gone) => apply(id, rev, [...active, 'fogGoneAt'], (r) => records.setFogGone(id, r, gone)),
        recordGate: (id, rev, gate) =>
            apply(id, rev, [...active, 'body.brief', 'gate', 'ticket'], (r) => records.recordGate(id, r, gate)),
        snapshotRun: (id, rev, input) =>
            apply(id, rev, [...active, `runSettings.${input.runId}`], (r) => records.snapshotRun(id, r, input)),
        startRoleRun: (id, rev, input) =>
            apply(id, rev, [...build, `runSettings.${input.runId}`, `roleRuns.${input.executionId}`], (r) =>
                records.startRoleRun(id, r, input),
            ),
        finishRoleRun: (id, rev, input) =>
            apply(id, rev, [...build, `roleRuns.${input.executionId}`], (r) => records.finishRoleRun(id, r, input)),
        updateDependency: (id, rev, patch) =>
            apply(
                id,
                rev,
                [
                    ...Object.keys(patch),
                    ...(patch.ticket !== undefined || patch.pullRequests !== undefined ? ['observations'] : []),
                ],
                (r) => records.updateDependency(id, r, patch),
                'dependency',
            ),
        addDependencyBlock: (id, rev, target) =>
            apply(id, rev, ['blocks', 'replacedBy'], (r) => records.addDependencyBlock(id, r, target), 'dependency'),
        removeDependencyBlock: (id, rev, target) =>
            apply(id, rev, ['blocks', 'replacedBy'], (r) => records.removeDependencyBlock(id, r, target), 'dependency'),
        observeDependency: (id, rev, observation) =>
            apply(
                id,
                rev,
                ['ticket', 'pullRequests', `observations.${observation.subject}`],
                (r) => records.observeDependency(id, r, observation),
                'dependency',
            ),
        markDependencyMet: (id, rev, by) =>
            apply(
                id,
                rev,
                ['metBy', 'metAt', 'need', 'contract', 'evidence', 'ticket', 'pullRequests', 'observations'],
                (r) => records.markDependencyMet(id, r, by),
                'dependency',
            ),
        clearDependencyMet: (id, rev) =>
            apply(id, rev, ['metBy', 'metAt'], (r) => records.clearDependencyMet(id, r), 'dependency'),
        replaceDependencyWithBuild: (id, rev, target) =>
            apply(
                id,
                rev,
                ['blocks', 'replacedBy'],
                (r) => records.replaceDependencyWithBuild(id, r, target),
                'dependency',
            ),
    };
}
