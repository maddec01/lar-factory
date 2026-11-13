import { changeKind } from './change-kind.ts';
import { createRecordTicket } from './create-ticket.ts';
import { WorkRecordError, type WorkRecords } from './work-records.ts';

const kindFields = ['kind', 'kindAnswer', 'ticket'];
const ticketFields = ['ticket', 'title', 'kind', 'body.brief', 'gate'];

/** Anchor the local kind commit to the intent from before provider calls, including on partial recovery. */
export async function changeAgentKind(
    records: WorkRecords,
    id: string,
    revision: number,
    kind: Parameters<typeof changeKind>[3],
    deps: Parameters<typeof changeKind>[4],
): ReturnType<typeof changeKind> {
    const anchored: WorkRecords = {
        ...records,
        update: (workId, _revision, patch) =>
            records.update(workId, records.writeRevision(workId, revision, kindFields), patch),
    };

    for (let attempt = 0; attempt < 10; attempt++) {
        const latest = records.writeRevision(id, revision, kindFields);

        try {
            return await changeKind(anchored, id, latest, kind, deps);
        } catch (error) {
            // changeKind catches failures after provider calls. Only its initial strict read can reach here.
            if (!(error instanceof WorkRecordError) || error.code !== 'stale-revision') throw error;
        }
    }
    throw contention(id);
}

/** A durable request reuses its saved draft. Retry only the refusal before any capture/provider write. */
export async function createAgentTicket(
    id: string,
    input: Parameters<typeof createRecordTicket>[1] & { revision: number; requestId: string },
    deps: Parameters<typeof createRecordTicket>[2],
): ReturnType<typeof createRecordTicket> {
    for (let attempt = 0; attempt < 10; attempt++) {
        const revision = deps.records.captureSubmission(input.requestId)
            ? input.revision
            : deps.records.writeRevision(id, input.revision, ticketFields);
        const result = await createRecordTicket(id, { ...input, revision }, deps);

        if (result.body.error !== 'The item changed. Reopen Create issue to preview its current text.') return result;
    }
    throw contention(id);
}

const contention = (id: string) =>
    new WorkRecordError(
        'stale-revision',
        `The work record ${id} kept changing during reapplication. Reread the record and decide whether to reapply the write.`,
    );
