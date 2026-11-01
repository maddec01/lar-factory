import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';
import { formatTicketSpec, readTrackerStructure, type RepositorySetup } from '@lar-factory/shared';
import * as settings from '@lar-factory/shared/repository-settings';
import { openWorkRecords } from '@lar-factory/work-records';
import * as tracker from '@lar-factory/work-records/tracker-sync';
import { importPickedTicket } from './import-ticket.ts';

test('structure recovery extracts each marked ticket Original and restores no brief', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-structure-'));
  const source = await openWorkRecords(join(dir, 'source.db'));
  const restored = await openWorkRecords(join(dir, 'restored.db'));
  try {
    const repository = 'example/product';
    const setups = [{ repo: repository, structureSync: true, access: { 'edit-ticket': 'allowed', 'publish-ticket': 'allowed', 'comment-ticket': 'allowed', 'tag-ticket': 'allowed' }, vocabulary: {} }] as RepositorySetup[];
    const root = source.create({ repository, kind: 'concept', title: 'Concept', ticket: `${repository}#1` });
    const child = source.create({ repository, kind: 'build', title: 'Build', ticket: `${repository}#2` });
    source.setParent(child.workId, child.revision, root.workId);
    const tickets = new Map<number, tracker.StructureTicket>([1, 2].map(number => [number, { repository, number, title: `Ticket ${number}`, version: '1', body: formatTicketSpec(`Spec ${number}`, `Original ${number}`) }]));
    const comments = new Map<string, string>();
    const provider = {
      read: async (_repository, number) => ({ ...tickets.get(number)! }),
      replace: async (ticket, body) => { tickets.set(ticket.number, { ...ticket, body }); },
      comment: async (_ticket, body) => { const id = String(comments.size + 1); comments.set(id, body); return id; },
      readComment: async (_ticket, id) => comments.get(id)!,
    } as tracker.StructureProvider;
    await tracker.syncStructures(source, { provider, setups });
    const ticket = tickets.get(1)!;
    const metadata = readTrackerStructure(ticket.body)!;
    expect(metadata.snapshot).toBeDefined();
    vi.spyOn(tracker, 'structureProvider').mockReturnValue(provider);
    vi.spyOn(settings, 'readRepositorySetups').mockReturnValue(setups);
    vi.spyOn(settings, 'readConnections').mockReturnValue([]);
    vi.spyOn(settings, 'saveConnections').mockImplementation(() => []);
    await importPickedTicket(restored, repository, { number: 1, title: 'Concept', text: ticket.body, url: '', kind: 'concept', tracker: metadata });
    for (const number of [1, 2]) {
      const record = restored.list({}).find(record => record.ticket === `${repository}#${number}`)!;
      expect(restored.initialContext(record.workId)).toBe(`Original ${number}`);
      expect(restored.body(record.workId, 'brief')).toBeNull();
    }
  } finally {
    vi.restoreAllMocks();
    source.close(); restored.close(); rmSync(dir, { recursive: true, force: true });
  }
});
