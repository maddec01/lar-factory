import { createHash } from 'node:crypto';

import { WorkRecordError } from './database.ts';

export interface GateDisplay {
    workId: string;
    sourceRevision: number;
    brief: string;
    briefDigest: string;
    approvalDigest: string;
    reviewDigest?: string;
}
export interface GateApproval {
    batchDigest?: string;
    reviewDigest?: string;
    briefDigest: string;
    approvedBy: string;
    evidence: string;
    approvalDigest?: string;
}

export function makeGateDisplay(
    workId: string,
    sourceRevision: number,
    brief: string,
    reviewDigest?: string,
): GateDisplay {
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const briefDigest = hash(brief);
    const content = { workId, brief, briefDigest, ...(reviewDigest && { reviewDigest }) };

    return { ...content, sourceRevision, approvalDigest: hash(content) };
}

/** Both the displayed copy and current source must match the digest the user approved. */
export function verifyGateDisplay(display: GateDisplay, approved: string, current: GateDisplay): void {
    if (
        !display ||
        display.workId !== current.workId ||
        display.sourceRevision !== current.sourceRevision ||
        display.brief !== current.brief ||
        display.briefDigest !== current.briefDigest ||
        display.reviewDigest !== current.reviewDigest ||
        display.approvalDigest !== current.approvalDigest ||
        approved !== current.approvalDigest
    )
        throw new WorkRecordError(
            'invalid',
            'The displayed brief, revision or approval digest changed; rerun Doubt and display the gate for renewed approval.',
        );
}
