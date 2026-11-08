// The board server's reads for onboarding: the T3 projects a repository can be set up from.

import type { ProjectChoice } from '@lar-factory/shared';

/** T3's projects, or why they couldn't be read. */
export async function readOnboardingProjects(): Promise<
    { projects: ProjectChoice[] } | { error: string; code?: string }
> {
    try {
        const response = await fetch('/api/onboarding/projects', { cache: 'no-store' });
        const body = (await response.json()) as { projects?: ProjectChoice[]; error?: string; code?: string };

        return body.projects
            ? { projects: body.projects }
            : { error: body.error ?? `The board answered ${response.status}.`, ...(body.code && { code: body.code }) };
    } catch {
        return { error: 'Can’t reach the board.' };
    }
}
