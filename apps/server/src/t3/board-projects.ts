import { boardSessionAuthority } from './board-session.ts';
import { keychainSessionVault } from './keychain-session.ts';
import { ProjectProtocol } from './project-protocol.ts';

/** Server-only API for #700. The caller supplies the installed runtime's version. */
export function boardProjects(baseUrl: string, version: string): ProjectProtocol {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Expected local T3 server');
  return new ProjectProtocol(keychainSessionVault(), boardSessionAuthority(), token => fetch(new URL('/api/projects', url), {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), version);
}
