import type { BoardData } from '@lar-factory/shared';

const REASONS = {
    access: 'Sample projects can’t edit ticket metadata or check access.',
    tools: 'Sample mode can’t run tool checks.',
    createIssue: 'Sample boards are read-only. Adding items, creating issues and checking access are disabled.',
} as const;

/** Sample capabilities have one explanation everywhere; ordinary access results remain the caller’s own. */
export function sampleCapability(data: Pick<BoardData, 'capture'>, capability: keyof typeof REASONS): string | null {
    return data.capture?.enabled === false ? REASONS[capability] : null;
}
