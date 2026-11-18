import { setReadSessions as setOwn, type BoardSessions } from '../src/t3/read-session.ts';

export { boardReadSession } from '../src/t3/read-session.ts';

/** Spawned boards issue no session, so a sample board holds this one to revoke when it stops. */
export const setReadSessions = (own: BoardSessions): void => {
    setOwn(own);
    void own.vault.write({ token: 'fake-token', sessionId: 'fake-session', expiresAt: '2099-01-01T00:00:00Z' });
};
