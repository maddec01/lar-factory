import { boardSessionAuthority } from './board-session.ts';
import { keychainSessionVault } from './keychain-session.ts';
import { ProjectProtocol } from './project-protocol.ts';

/**
 * Server-only API for #700. Supply origin and serverVersion from T3 runtime discovery.
 * readProjects retains the last successful observation on failure; reauthorize uses
 * the local auth control plane. Neither operation belongs in browser code.
 *
 * Source: pingdotgg/t3code 97e35bcf23e4, packages/contracts/src/environmentHttp.ts
 * and project.ts; apps/server/src/cli/auth.ts and cliAuthFormat.ts.
 * Exercised on 2026-10-31 with nightly 0.1.6-nightly.20261030.3917:
 * separate orchestration:read session, Keychain write/read, GET /api/projects,
 * eight projects returned. Rejection and renewal failures use controlled fixtures.
 * Subscriptions and existing consumer migration belong to #700.
 */
export function boardProjects(baseUrl: string, version: string): ProjectProtocol {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Expected local T3 server');
  return new ProjectProtocol(keychainSessionVault(), boardSessionAuthority(), token => fetch(new URL('/api/projects', url), {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), version);
}
