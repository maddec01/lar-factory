// Picking imports durable structure once. It starts every recovered record in List and preserves later local work.
import { mapConcurrent, readTicketSpec, stripTrackerStructure, type PickedTicket } from '@lar-factory/shared';
import { readRepositorySetups, readConnections, saveConnections } from '@lar-factory/shared/repository-settings';
import type { WorkRecord, WorkRecords } from '@lar-factory/work-records';
import { readStructureSnapshot, structureProvider } from '@lar-factory/work-records/tracker-sync';

export async function importPickedTicket(records: WorkRecords, repository: string, ticket: PickedTicket, requestId?: string): Promise<{ record: WorkRecord; created: boolean }> {
  const reference = `${repository}#${ticket.number}`;
  const held = records.list({repository}).find(record => record.ticket?.toLowerCase() === reference.toLowerCase());
  if (held && !requestId) return { record: held, created: false };
  if (ticket.tracker?.snapshot) {
    const provider = structureProvider();
    const current = await provider.read(repository, ticket.number);
    const setups=readRepositorySetups();
    const { snapshot, digest } = await readStructureSnapshot(current, ticket.tracker, provider, setups);
    const contexts=Object.fromEntries(await mapConcurrent(snapshot.nodes.filter(node=>node.ticket),async node=>{
      const number=Number(node.ticket!.slice(node.ticket!.lastIndexOf('#')+1));
      const read=node.repository===repository && number===ticket.number ? current : await provider.read(node.repository,number);
      const body = stripTrackerStructure(read.body).replace(/<!-- lar-factory:create [^\n]*? -->/g, '').trimEnd();
      const parsed = readTicketSpec(body);
      return [node.ticket!, parsed.marked ? parsed.original ?? '' : body] as const;
    }));
    records.trackerRestore(snapshot, digest,contexts);
    const repositories=[...new Set(snapshot.nodes.map(node=>node.repository))].filter(repo=>setups.some(setup=>setup.repo.toLowerCase()===repo.toLowerCase()));
    for (const repo of repositories) saveConnections(repo,[...readConnections(repo),...repositories.filter(other=>other!==repo)]);
    const restored = records.list({repository}).find(record => record.ticket?.toLowerCase() === reference.toLowerCase());
    if (!restored) throw Error('The saved structure does not contain this issue.');
    return { record: restored, created: true };
  }
  const context = requestId ? ticket.text : ticket.text.replace(/<!-- lar-factory:structure\s*\n[\s\S]*?\n-->/g, '').replace(/<!-- lar-factory:create [^\n]*? -->/g, '').trimEnd();
  const parsed = readTicketSpec(context);
  const input = { title: ticket.title, context: parsed.marked ? parsed.original ?? '' : context, repository, kind: ticket.kind, ticket: reference };
  const imported = requestId ? records.completeCapture(requestId, input) : records.importTicket(input);
  if (ticket.kind === 'concept') {
    const map = ticket.tracker?.map ?? context;
    if (map.trim()) imported.record = records.setBody(imported.record.workId, imported.record.revision, 'map', map);
  }
  return imported;
}
