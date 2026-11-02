import { isRecord } from '@lar-factory/shared';

export interface BoardSession { token: string; sessionId: string; expiresAt: string }
/** Implementations must persist only in the operating system credential store. */
export interface SessionVault {
  read(): Promise<BoardSession | undefined>;
  write(session: BoardSession): Promise<void>;
}
export interface SessionAuthority {
  issue(): Promise<BoardSession>;
  revoke(sessionId: string): Promise<void>;
}
interface ProjectFact { id: string; title: string; workspaceRoot: string }
export interface ProjectObservation { projects: ProjectFact[]; observedAt: string }
type ProjectAvailability = 'available' | 'unavailable' | 'renewal-required' | 'malformed';
export interface ProjectRead { availability: ProjectAvailability; observation?: ProjectObservation }

/** Server-only authenticated reads. Validate the response contract, regardless of release version.
 * No errors or credentials cross this boundary. */
export class ProjectProtocol {
  private observation?: ProjectObservation;
  private snapshotTime = -Infinity;
  private session?: BoardSession;
  private generation = 0;
  private forceRenewal = false;
  private pending?: Promise<BoardSession>;
  private readonly vault: SessionVault;
  private readonly authority: SessionAuthority;
  private readonly request: (token: string) => Promise<Response>;
  private readonly now: () => number;
  constructor(vault: SessionVault, authority: SessionAuthority,
    request: (token: string) => Promise<Response>, _serverVersion: string,
    now: () => number = Date.now) {
    this.vault = vault;
    this.authority = authority;
    this.request = request;
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
    try { await this.pending; } catch { /* A failed acquisition can be retried. */ }
    await this.subscriptionSession();
  }

  subscriptionSession(): Promise<BoardSession> {
    if (this.pending) return this.pending;
    if (this.session && Date.parse(this.session.expiresAt) > this.now() + 60_000) return Promise.resolve(this.session);
    const generation = this.generation;
    const acquisition = (async () => {
      const previous = this.session ?? await this.vault.read();
      if (generation !== this.generation) throw new Error('Session invalidated');
      if (!this.forceRenewal && previous?.token && previous.sessionId && Date.parse(previous.expiresAt) > this.now() + 60_000) {
        this.session = previous;
        return previous;
      }
      this.session = undefined;
      this.forceRenewal = true;
      const session = await this.authority.issue();
      if (!session.token || !session.sessionId || !(Date.parse(session.expiresAt) > this.now() + 60_000)) throw new Error('Invalid session');
      try {
        if (generation !== this.generation) throw new Error('Session invalidated');
        await this.vault.write(session);
        if (generation !== this.generation) throw new Error('Session invalidated');
        if (previous) await this.authority.revoke(previous.sessionId);
        if (generation !== this.generation) throw new Error('Session invalidated');
      } catch {
        await this.authority.revoke(session.sessionId);
        throw new Error('Session renewal failed');
      }
      this.session = session;
      this.forceRenewal = false;
      return session;
    })().finally(() => { if (this.pending === acquisition) this.pending = undefined; });
    this.pending = acquisition;
    return acquisition;
  }

  async readProjects(): Promise<ProjectRead> {
    const result = (availability: ProjectAvailability): ProjectRead => ({ availability, ...(this.observation ? { observation: this.observation } : {}) });
    let session: BoardSession;
    try {
      session = await this.subscriptionSession();
    } catch { return result('renewal-required'); }
    try {
      const response = await this.request(session.token);
      if (response.status === 401 || response.status === 403) { this.invalidateSession(session); return result('renewal-required'); }
      if (!response.ok) return result('unavailable');
      let body: unknown;
      try { body = await response.json(); } catch { return result('malformed'); }
      if (!isRecord(body) || typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt)) || !Array.isArray(body.projects)) return result('malformed');
      const projects: ProjectFact[] = [];
      for (const project of body.projects) {
        if (!isRecord(project) || !['id', 'title', 'workspaceRoot'].every(key => typeof project[key] === 'string' && project[key].trim())) return result('malformed');
        projects.push({ id: project.id as string, title: project.title as string, workspaceRoot: project.workspaceRoot as string });
      }
      const snapshotTime = Date.parse(body.updatedAt);
      if (snapshotTime < this.snapshotTime) return result('malformed');
      this.snapshotTime = snapshotTime;
      this.observation = { projects, observedAt: new Date(this.now()).toISOString() };
      return result('available');
    } catch { this.invalidateSession(session); return result('unavailable'); }
  }
}
