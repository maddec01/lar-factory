import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs, promisify } from 'node:util';

import { refreshBoards } from './board-refresh.ts';
// A remote human request may approve its exact scope correction; agent-supplied identities cannot.
import type { GateDisplay } from './gate-display.ts';
import type { PrAmendmentDisplay } from './linked-pr-amendment.ts';
import { refreshSpecs, syncSpecs } from './spec-sync.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

const exec = promisify(execFile);
const github = async (path: string): Promise<Record<string, unknown>> =>
    JSON.parse((await exec('gh', ['api', path], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })).stdout);

/** The display/digest still goes through the ordinary scope, fresh Doubt and gate checks. */
async function authorizePrAmendment(records: WorkRecords, id: string, source: string, read: typeof github = github) {
    const record = records.read(id);
    const reference = record.pullRequest;

    if (!reference || !reference.startsWith(`${record.repository}#`) || record.finishedAt || record.setAside)
        throw new Error('An active delivery PR is required.');

    if (!records.gate(id).evidence.some((gate) => gate.source === 'gate' || gate.source === 'user'))
        throw new Error('PR scope amendments require an originally approved build.');

    const number = Number(reference.slice(reference.lastIndexOf('#') + 1));
    const repo = record.repository;
    let by: string;
    let evidence: string;

    if (source.startsWith('verify:')) {
        const result = records.verification(id).latest;

        if (!result || result.id !== source.slice(7) || result.result !== 'fail' || result.pr !== reference)
            throw new Error('Use the latest recorded human Verify failure.');

        by = result.by;
        evidence = `Human Verify amendment ${result.id}, PR ${reference}, head ${result.head}: ${result.note}`;
    } else {
        const url = new URL(source);

        if (records.prLoop(id).agentComments.includes(source))
            throw new Error('An agent reply cannot authorize a Spec amendment.');

        const match = /^\/([^/]+\/[^/]+)\/pull\/([1-9][0-9]*)$/.exec(url.pathname);
        const fragment = /^#(issuecomment-|discussion_r|pullrequestreview-)([1-9][0-9]*)$/.exec(url.hash);

        if (
            url.origin !== 'https://github.com' ||
            url.username ||
            url.password ||
            url.search ||
            !match ||
            match[1]!.toLowerCase() !== repo.toLowerCase() ||
            Number(match[2]) !== number ||
            !fragment
        )
            throw new Error('Use a review or comment URL on this recorded GitHub PR.');

        const path =
            fragment[1] === 'issuecomment-'
                ? `repos/${repo}/issues/comments/${fragment[2]}`
                : fragment[1] === 'discussion_r'
                  ? `repos/${repo}/pulls/comments/${fragment[2]}`
                  : `repos/${repo}/pulls/${number}/reviews/${fragment[2]}`;
        const comment = await read(path);
        const user = comment.user as { login?: string; type?: string } | undefined;

        if (
            comment.html_url !== source ||
            user?.type !== 'User' ||
            !user.login ||
            typeof comment.body !== 'string' ||
            !comment.body.trim() ||
            comment.state === 'DISMISSED'
        )
            throw new Error('The request must be a current human review or comment.');

        const permission = await read(`repos/${repo}/collaborators/${encodeURIComponent(user.login)}/permission`);

        if (!['write', 'maintain', 'admin'].includes(String(permission.permission)))
            throw new Error('Only a human with repository write access can approve a scope amendment.');

        const pr = await read(`repos/${repo}/pulls/${number}`);

        if (pr.state !== 'open' || pr.merged || pr.html_url !== `https://github.com/${repo}/pull/${number}`)
            throw new Error('The delivery PR is no longer open.');

        by = user.login;
        evidence = `Human PR scope amendment ${source}: ${comment.body}`;
    }

    // No arbitrary identity, body, or gate source is accepted from the agent.
    if (records.read(id).pullRequest !== reference)
        throw new Error('The delivery PR or amendment changed. Read its gate again.');

    if (records.prLoop(id).agentComments.includes(source))
        throw new Error('An agent reply cannot authorize a Spec amendment.');

    return { by, evidence, reference };
}

export async function beginPrAmendment(
    records: WorkRecords,
    id: string,
    source: string,
    read: typeof github = github,
    affected?: string[],
) {
    const { by, evidence, reference } = await authorizePrAmendment(records, id, source, read);
    const state = records.prLoop(id);

    if (state.pr !== reference) throw Error('The delivery PR changed.');

    if (affected) return records.beginLinkedPrAmendment(id, { source, by, evidence }, affected);

    if (state.amendment?.workIds) throw Error('Finish the linked amendment as one batch.');

    state.amendment = { source, by, evidence };
    records.savePrLoop(id, state);

    return state.amendment;
}

export async function approvePrAmendment(
    records: WorkRecords,
    id: string,
    display: GateDisplay | PrAmendmentDisplay,
    digest: string,
    source: string,
    read: typeof github = github,
) {
    const { by, evidence } = await authorizePrAmendment(records, id, source, read);

    const held = records.activePrAmendment(id);

    if (held && held.ownerId !== id) throw Error('Approve this amendment through its producer owner.');

    const amendment = records.prLoop(id).amendment;

    if (amendment && (amendment.source !== source || amendment.by !== by || amendment.evidence !== evidence))
        throw Error('The authorizing comment changed. Begin and review the amendment again.');

    if ('ownerId' in display) {
        if (display.ownerId !== id) throw Error('The amendment owner changed.');

        return records.recordLinkedPrAmendment(display, digest, by, evidence);
    }

    if (amendment?.workIds) throw Error('Approve the complete linked amendment, not an individual gate.');

    if (display.workId !== id) throw Error('The amendment changed. Read its gate again.');

    return records.recordPrAmendmentGate(display, digest, by, evidence, source);
}

export async function prAmendmentCommand(args: string[], mode: 'begin' | 'display' | 'approve'): Promise<number> {
    let records: WorkRecords | undefined;

    try {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: {
                file: { type: 'string' },
                affected: { type: 'string' },
                digest: { type: 'string' },
                feedback: { type: 'string' },
                'data-dir': { type: 'string' },
            },
        });

        if (
            positionals.length !== 1 ||
            (mode === 'approve' && (!values.file || !values.digest)) ||
            (mode !== 'display' && !values.feedback)
        )
            throw new Error(
                'Use approve-pr-amendment ID --file display.json --digest SHA --feedback URL|verify:RESULT_ID.',
            );

        records = await openWorkRecords(workRecordsPath(values['data-dir']));

        const id = positionals[0]!;
        const affected = values.affected ? JSON.parse(readFileSync(values.affected, 'utf8')) : undefined;

        if (affected !== undefined && (!Array.isArray(affected) || affected.some((id) => typeof id !== 'string')))
            throw Error('Affected work must be a list of work IDs.');

        const workIds = records.prLoop(id).amendment?.workIds ?? [id];

        if (mode !== 'begin') await refreshSpecs(records, { workIds, dir: values['data-dir'] });

        const result =
            mode === 'begin'
                ? await beginPrAmendment(records, id, values.feedback!, github, affected)
                : mode === 'display'
                  ? records.displayPrAmendment(id)
                  : await approvePrAmendment(
                        records,
                        positionals[0]!,
                        JSON.parse(readFileSync(values.file!, 'utf8')),
                        values.digest!,
                        values.feedback!,
                    );

        const changedIds = mode === 'begin' ? (records.prLoop(id).amendment?.workIds ?? [id]) : workIds;

        if (mode === 'begin') await refreshSpecs(records, { workIds: changedIds, dir: values['data-dir'] });

        if (mode === 'approve')
            for (const workId of changedIds) await syncSpecs(records, { workId, dir: values['data-dir'] });

        for (const workId of changedIds) await refreshBoards(workId, values['data-dir']);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
