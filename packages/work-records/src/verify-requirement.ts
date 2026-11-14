import { createHash } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';

/** An explicit Verify section belongs to the approved product brief, never an approver recommendation. */
export function parseBriefVerify(brief: string): boolean | null {
    let fenced = false;
    let reading = false;
    const lines: string[] = [];

    for (const line of brief.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            continue;
        }

        if (fenced) continue;

        if (/^##\s+/.test(line)) {
            if (reading) break;

            reading = /^##\s+Verify\s*$/i.test(line);
        } else if (reading) lines.push(line);
    }

    const value = lines.join('\n').trim();

    if (!value) return null; // Retain legacy records without a Verify decision.

    if (!/^(yes\b|no\s*$)/i.test(value))
        throw new WorkRecordError(
            'invalid',
            'Verify must say yes with the visible check, or no. Amend the brief through Doubt and a gate.',
        );

    return /^yes\b/i.test(value);
}

export function briefVerify(database: Database, id: string): { required: boolean; approved: boolean } | null {
    const row = database.db.prepare("SELECT markdown FROM bodies WHERE work_id=? AND body='brief'").get(id);

    if (!row) return null;

    const brief = String(row.markdown);
    const required = parseBriefVerify(brief);

    if (required === null) return null;

    const digest = createHash('sha256').update(JSON.stringify(brief)).digest('hex');
    const approved = !!database.db
        .prepare(
            "SELECT 1 FROM brief_gates WHERE work_id=? AND brief_digest=? AND invalidated=0 AND source IN ('gate','user')",
        )
        .get(id, digest);

    return { required, approved };
}
