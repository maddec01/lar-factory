import type { GateEvidence } from '@lar-factory/shared';
import { createHash } from 'node:crypto';

import type { DoubtReview } from './brief-review.ts';
import { WorkRecordError } from './database.ts';
import type { GateDisplay } from './gate-display.ts';

interface GateManifestMember {
    display: GateDisplay;
    doubt: DoubtReview;
}
export interface GateManifest {
    version: 1;
    members: GateManifestMember[];
    digest: string;
}
export interface GateBatchEvidence {
    digest: string;
    manifest: GateManifest;
    approvedBy: string;
    evidence: string;
    recordedAt: string;
    gates: GateEvidence[];
}

const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};

export function gateWorkIds(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length || value.some((id) => typeof id !== 'string' || !id))
        return invalid('A gate batch needs a nonempty list of work IDs.');

    if (new Set(value).size !== value.length) invalid('A gate manifest contains duplicate work IDs.');

    return value as string[];
}

export function gateManifest(members: GateManifestMember[]): GateManifest {
    const content = { version: 1 as const, members };

    return { ...content, digest: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
}

/** Reject malformed or edited display files before ticket refresh or any approval write. */
export function readGateManifest(value: unknown): GateManifest {
    if (!value || typeof value !== 'object') invalid('Expected a displayed gate manifest.');

    const manifest = value as GateManifest;

    if (manifest.version !== 1 || !Array.isArray(manifest.members) || !manifest.members.length)
        invalid('A gate manifest needs at least one complete member.');

    const ids = manifest.members.map((member) => {
        if (
            !member ||
            !member.display ||
            !member.doubt ||
            typeof member.display.workId !== 'string' ||
            !member.display.workId
        )
            invalid('Every manifest member needs a complete gate display and Doubt result.');

        return member.display.workId;
    });

    if (new Set(ids).size !== ids.length) invalid('A gate manifest contains duplicate work IDs.');

    if (gateManifest(manifest.members).digest !== manifest.digest)
        invalid('The displayed gate manifest changed; display it again for renewed approval.');

    return manifest;
}
