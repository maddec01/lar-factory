import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BoardSession, SessionAuthority } from './project-protocol.ts';

const exec = promisify(execFile);

/** Separate least-privilege session issued through T3's local auth control plane. */
export function boardSessionAuthority(cli = 't3'): SessionAuthority {
  return {
    async issue(): Promise<BoardSession> {
      try {
        const { stdout } = await exec(cli, ['auth', 'session', 'issue', '--scope', 'orchestration:read', '--ttl', '1h', '--subject', 'lar-factory-board', '--label', 'Lar Factory board', '--json'], { timeout: 30_000, maxBuffer: 64 * 1024 });
        const value: unknown = JSON.parse(stdout);
        if (typeof value !== 'object' || value === null || !('token' in value) || !('sessionId' in value) || !('expiresAt' in value) || typeof value.token !== 'string' || typeof value.sessionId !== 'string' || typeof value.expiresAt !== 'string') throw Error();
        return { token: value.token, sessionId: value.sessionId, expiresAt: value.expiresAt };
      } catch { throw new Error('Board session issuance failed'); }
    },
    async revoke(id): Promise<void> {
      try { await exec(cli, ['auth', 'session', 'revoke', id], { timeout: 30_000 }); }
      catch { throw new Error('Board session revocation failed'); }
    },
  };
}
