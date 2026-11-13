import { isRecord, PROJECT_ICON_COLORS, type ChosenProjectIcon } from '@lar-factory/shared';

export interface BoardSession {
    token: string;
    sessionId: string;
    expiresAt: string;
}
/** Implementations must persist only in the operating system credential store. */
export interface SessionVault {
    read: () => Promise<BoardSession | undefined>;
    write: (session: BoardSession) => Promise<void>;
}
export interface SessionAuthority {
    issue(): Promise<BoardSession>;
    revoke(sessionId: string): Promise<void>;
}
export interface ProjectFact {
    id: string;
    title: string;
    workspaceRoot: string;
    faviconPath: string | null;
    projectIcon: ChosenProjectIcon | null;
}
export interface ProjectObservation {
    projects: ProjectFact[];
    observedAt: string;
}
type ProjectAvailability = 'available' | 'unavailable' | 'renewal-required' | 'malformed';
export interface ProjectRead {
    availability: ProjectAvailability;
    observation?: ProjectObservation;
}

/** T3's chosen icon contract, or null for anything else, so an icon T3 adds later leaves the project listed. */
function chosenIcon(value: unknown): ChosenProjectIcon | null {
    if (!isRecord(value)) return null;

    const color = PROJECT_ICON_COLORS.find((known) => known === value.color);

    if (
        value.kind === 'lucide' &&
        color &&
        typeof value.name === 'string' &&
        value.name.length <= 64 &&
        /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value.name)
    )
        return { kind: 'lucide', name: value.name, color };

    if (value.kind === 'emoji' && typeof value.emoji === 'string') {
        const emoji = value.emoji.trim();

        if (emoji && emoji.length <= 32) return { kind: 'emoji', emoji };
    }

    if (
        value.kind === 'monogram' &&
        color &&
        typeof value.text === 'string' &&
        value.text.length <= 32 &&
        /^[\p{L}\p{N}][\p{L}\p{N}\p{M}\u200C\u200D]*$/u.test(value.text)
    )
        return { kind: 'monogram', text: value.text, color };

    return null;
}

/** A project's icon fields. An invalid value is null, as an older T3's missing one is, unless `previous` holds what an omitted field keeps. */
export function projectIconFields(
    input: Record<string, unknown>,
    previous?: Pick<ProjectFact, 'faviconPath' | 'projectIcon'>,
): Pick<ProjectFact, 'faviconPath' | 'projectIcon'> {
    const { faviconPath, projectIcon } = input;

    return {
        faviconPath:
            faviconPath === undefined
                ? (previous?.faviconPath ?? null)
                : typeof faviconPath === 'string' && faviconPath.trim()
                  ? faviconPath
                  : null,
        projectIcon: projectIcon === undefined ? (previous?.projectIcon ?? null) : chosenIcon(projectIcon),
    };
}

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
    constructor(
        vault: SessionVault,
        authority: SessionAuthority,
        request: (token: string) => Promise<Response>,
        _serverVersion: string,
        now: () => number = Date.now,
    ) {
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

                if (previous) await this.authority.revoke(previous.sessionId);

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

    async readProjects(): Promise<ProjectRead> {
        const result = (availability: ProjectAvailability): ProjectRead => ({
            availability,
            ...(this.observation ? { observation: this.observation } : {}),
        });
        let session: BoardSession;

        try {
            session = await this.subscriptionSession();
        } catch {
            return result('renewal-required');
        }

        try {
            const response = await this.request(session.token);

            if (response.status === 401 || response.status === 403) {
                this.invalidateSession(session);

                return result('renewal-required');
            }

            if (!response.ok) return result('unavailable');

            let body: unknown;

            try {
                body = await response.json();
            } catch {
                return result('malformed');
            }

            if (
                !isRecord(body) ||
                typeof body.updatedAt !== 'string' ||
                !Number.isFinite(Date.parse(body.updatedAt)) ||
                !Array.isArray(body.projects)
            )
                return result('malformed');

            const projects: ProjectFact[] = [];

            for (const project of body.projects) {
                if (
                    !isRecord(project) ||
                    !['id', 'title', 'workspaceRoot'].every(
                        (key) => typeof project[key] === 'string' && project[key].trim(),
                    )
                )
                    return result('malformed');

                projects.push({
                    id: project.id as string,
                    title: project.title as string,
                    workspaceRoot: project.workspaceRoot as string,
                    ...projectIconFields(project),
                });
            }

            const snapshotTime = Date.parse(body.updatedAt);

            if (snapshotTime < this.snapshotTime) return result('malformed');

            this.snapshotTime = snapshotTime;
            this.observation = { projects, observedAt: new Date(this.now()).toISOString() };

            return result('available');
        } catch {
            // A transport failure does not reject a credential shared by other boards.
            return result('unavailable');
        }
    }
}
