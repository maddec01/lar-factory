import type { BoardSessions } from './board-projects.ts';
import { boardSessionAuthority } from './board-session.ts';
import type { BoardSession } from './project-protocol.ts';

/**
 * The session of a sample board that reads T3: its own, held only in memory, so it never reads, writes or revokes the
 * saved session of a live board running beside it. T3 expires one a crash leaves behind within its hour.
 */
export function sampleT3Session(cli = 't3'): BoardSessions & { revoke(): Promise<void> } {
    const authority = boardSessionAuthority(cli, 'orchestration:read', {
        subject: 'lar-factory-sample-board',
        label: 'Lar Factory sample board',
    });
    let held: BoardSession | undefined;
    return {
        authority,
        vault: {
            async read() {
                return held;
            },
            async write(session) {
                held = session;
            },
        },
        async revoke() {
            const session = held;
            held = undefined;
            if (session) await authority.revoke(session.sessionId);
        },
    };
}
