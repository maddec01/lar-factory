import { boardSessionAuthority } from './board-session.ts';
import { keychainSessionVault } from './keychain-session.ts';
import { subscribeProjects } from './project-subscription.ts';
import { ProjectProtocol, type ProjectRead } from './project-protocol.ts';

/**
 * Server-only API for #700. Supply origin and release metadata from T3 runtime discovery.
 * Release metadata does not gate access; response validation determines compatibility.
 * readProjects retains the last successful observation on failure; reauthorize uses
 * the local auth control plane. Neither operation belongs in browser code.
 *
 * Source: pingdotgg/t3code 97e35bcf23e4, packages/contracts/src/environmentHttp.ts
 * and project.ts; apps/server/src/cli/auth.ts and cliAuthFormat.ts.
 * Exercised on 2026-10-31 with nightly 0.1.6-nightly.20261030.3917:
 * separate orchestration:read session, Keychain write/read, GET /api/projects,
 * eight projects returned. Rejection and renewal failures use controlled fixtures.
 * Existing consumer migration belongs to #706.
 */
export function boardProjects(baseUrl: string, version: string): ProjectProtocol {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Expected local T3 server');
  return new ProjectProtocol(keychainSessionVault(), boardSessionAuthority(), token => fetch(new URL('/api/projects', url), {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), version);
}

/** Authenticated shell subscription with retained observations and explicit cleanup. */
export function subscribeBoardProjects(baseUrl: string, version: string, onChange: (read: ProjectRead) => void): () => void {
  const protocol = boardProjects(baseUrl, version);
  return subscribeProjects(new URL(baseUrl), version, protocol, onChange);
}
