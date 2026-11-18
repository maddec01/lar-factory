import { boardSessionAuthority } from './board-session.ts';
import { keychainSessionVault } from './keychain-session.ts';
import type { BoardSession, SessionAuthority, SessionVault } from './project-protocol.ts';

/** Where a board's T3 session is kept and who issues it. */
export interface BoardSessions {
    vault: SessionVault;
    authority: SessionAuthority;
}

/**
 * The orchestration:read session every T3 read on the board shares. It renews a minute before it expires, about once
 * an hour, and never revokes the session it replaces: another reader may still hold it, and T3 expires it soon after.
 */
export class ReadSession {
    private session?: BoardSession;
    private generation = 0;
    private forceRenewal = false;
    private pending?: Promise<BoardSession>;
    private readonly vault: SessionVault;
    private readonly authority: SessionAuthority;
    private readonly now: () => number;
    constructor({ vault, authority }: BoardSessions, now: () => number = Date.now) {
        this.vault = vault;
        this.authority = authority;
        this.now = now;
    }

    /** Ignore late failures from consumers of an already replaced session. */
    invalidateSession(session: BoardSession): void {
        if (this.session !== session) return;

        this.session = undefined;
        this.generation++;
        this.forceRenewal = true;
    }

    async reauthorize(): Promise<void> {
        this.session = undefined;
        this.generation++;
        this.forceRenewal = true;

        try {
            await this.pending;
        } catch {
            /* A failed acquisition can be retried. */
        }

        await this.subscriptionSession();
    }

    subscriptionSession(): Promise<BoardSession> {
        if (this.pending) return this.pending;

        if (this.session && Date.parse(this.session.expiresAt) > this.now() + 60_000)
            return Promise.resolve(this.session);

        const generation = this.generation;
        const acquisition = (async () => {
            const previous = this.session ?? (await this.vault.read());

            if (generation !== this.generation) throw new Error('Session invalidated');

            if (
                !this.forceRenewal &&
                previous?.token &&
                previous.sessionId &&
                Date.parse(previous.expiresAt) > this.now() + 60_000
            ) {
                this.session = previous;

                return previous;
            }

            this.session = undefined;
            this.forceRenewal = true;

            const session = await this.authority.issue();

            if (!session.token || !session.sessionId || !(Date.parse(session.expiresAt) > this.now() + 60_000))
                throw new Error('Invalid session');

            try {
                if (generation !== this.generation) throw new Error('Session invalidated');

                await this.vault.write(session);

                if (generation !== this.generation) throw new Error('Session invalidated');
            } catch {
                await this.authority.revoke(session.sessionId);
                throw new Error('Session renewal failed');
            }

            this.session = session;
            this.forceRenewal = false;

            return session;
        })().finally(() => {
            if (this.pending === acquisition) this.pending = undefined;
        });

        this.pending = acquisition;

        return acquisition;
    }
}

let shared: ReadSession | undefined;

/** The board's one read session, kept in the Keychain unless `setReadSessions` gave it another. */
export function boardReadSession(): ReadSession {
    return (shared ??= new ReadSession({ vault: keychainSessionVault(), authority: boardSessionAuthority() }));
}

/** Has every T3 read use `own` (a sample board's session) from its next read. */
export function setReadSessions(own: BoardSessions): void {
    shared = new ReadSession(own);
}
