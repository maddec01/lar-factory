import { isRecord } from '@lar-factory/shared';

/** Exact contract verified against T3 source 97e35bcf23e4. */
export const supportedProjectVersion = '0.1.6-nightly.20261030.3917';
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
type ProjectAvailability = 'available' | 'unavailable' | 'renewal-required' | 'unsupported-version' | 'malformed';
export interface ProjectRead { availability: ProjectAvailability; observation?: ProjectObservation }

/** Server-only authenticated reads. No errors or credentials cross this boundary. */
export class ProjectProtocol {
  private observation?: ProjectObservation;
  private snapshotTime = -Infinity;
  private pending?: Promise<BoardSession>;
  private readonly vault: SessionVault;
  private readonly authority: SessionAuthority;
  private readonly request: (token: string) => Promise<Response>;
  private readonly version: string;
  private readonly now: () => number;
  constructor(vault: SessionVault, authority: SessionAuthority,
    request: (token: string) => Promise<Response>, version: string,
    now: () => number = Date.now) {
    this.vault = vault;
    this.authority = authority;
    this.request = request;
    this.version = version;
    this.now = now;
  }

  /** Reissue through the local control plane, then retire the previous session. */
  async reauthorize(): Promise<void> { await this.renew(); }

  private renew(): Promise<BoardSession> {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const previous = await this.vault.read();
      const session = await this.authority.issue();
      if (!session.token || !session.sessionId || !(Date.parse(session.expiresAt) > this.now() + 60_000)) throw new Error('Invalid session');
      try { await this.vault.write(session); }
      catch { await this.authority.revoke(session.sessionId); throw new Error('Credential storage failed'); }
      if (previous) await this.authority.revoke(previous.sessionId);
      return session;
    })().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  async subscriptionSession(): Promise<BoardSession> {
    const stored = await this.vault.read();
    return stored && Date.parse(stored.expiresAt) > this.now() + 60_000 ? stored : this.renew();
  }

  async readProjects(): Promise<ProjectRead> {
    const result = (availability: ProjectAvailability): ProjectRead => ({ availability, ...(this.observation ? { observation: this.observation } : {}) });
    if (this.version !== supportedProjectVersion) return result('unsupported-version');
    let session: BoardSession;
    try {
      const stored = await this.vault.read();
      session = stored && Date.parse(stored.expiresAt) > this.now() + 60_000 ? stored : await this.renew();
    } catch { return result('renewal-required'); }
    try {
      const response = await this.request(session.token);
      if (response.status === 401 || response.status === 403) return result('renewal-required');
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
    } catch { return result('unavailable'); }
  }
}
