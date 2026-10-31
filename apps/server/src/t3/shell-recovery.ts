import { isRecord } from '@lar-factory/shared';

/** Marked shell snapshots update project metadata, not the project/thread membership. */
export function projectMetadataSnapshot(value: Record<string, unknown>): boolean {
  if (value.resolvedRepositoryIdentityRoots === undefined) return false;
  if (!Array.isArray(value.resolvedRepositoryIdentityRoots) || !value.resolvedRepositoryIdentityRoots.every(root => typeof root === 'string')) throw Error('Invalid project metadata roots');
  return true;
}

/** T3 97e35bcf23e4, contracts/src/orchestrationV2.ts:2184-2223.
 * Shell sequence numbers cover thread changes too; project-only gaps are valid.
 */
export class ShellRecovery {
  private sequence = -1;
  private projects = new Map<string, { id: string; title: string; workspaceRoot: string }>();

  accept(value: unknown): boolean {
    if (!isRecord(value)) throw new Error('Invalid shell event');
    if (value.kind === 'synchronized') return false;
    const snapshot = value.kind === 'snapshot' && isRecord(value.snapshot) ? value.snapshot : undefined;
    const sequence = snapshot ? snapshot.snapshotSequence : value.sequence;
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid shell sequence');
    if (sequence < this.sequence || (!snapshot && sequence === this.sequence)) return false;
    const project = (input: unknown) => {
      if (!isRecord(input) || typeof input.id !== 'string' || typeof input.title !== 'string' || typeof input.workspaceRoot !== 'string') throw new Error('Invalid shell project');
      return { id: input.id, title: input.title, workspaceRoot: input.workspaceRoot };
    };
    let changed = false;
    if (snapshot) {
      if (!Array.isArray(snapshot.projects)) throw new Error('Invalid shell snapshot');
      const projects = snapshot.projects.map(project);
      const metadata = projectMetadataSnapshot(value);
      if (metadata && this.sequence < 0) throw Error('Full shell snapshot required');
      const next = metadata ? new Map(this.projects) : new Map<string, typeof projects[number]>();
      for (const item of projects) if (!metadata || next.has(item.id)) next.set(item.id, item);
      changed = JSON.stringify([...this.projects.values()]) !== JSON.stringify([...next.values()]);
      // The first empty snapshot still establishes an authoritative observation.
      if (this.sequence < 0) changed = true;
      this.projects = next;
      // Metadata does not cover intervening membership events in the live stream.
      if (metadata) return changed;
    } else if (value.kind === 'project.updated') {
      const next = project(value.project);
      this.projects.set(next.id, next);
      changed = true;
    } else if (value.kind === 'project.removed') {
      if (typeof value.projectId !== 'string') throw new Error('Invalid project removal');
      changed = this.projects.delete(value.projectId);
    } else if (value.kind !== 'thread.updated' && value.kind !== 'thread.removed') {
      throw new Error('Unknown shell event');
    }
    this.sequence = sequence;
    return changed;
  }

  observation(now: number = Date.now()) {
    return { projects: [...this.projects.values()], observedAt: new Date(now).toISOString() };
  }
}
