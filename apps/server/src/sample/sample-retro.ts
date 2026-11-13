import type { RepoConfig } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** Disposable, provider-confirmed merge fixtures; never dispatch a real T3 command. */
export function sampleRetro(
    records: WorkRecords,
    repos: () => RepoConfig[],
    refresh: () => void,
    input: Record<string, unknown>,
) {
    if (!['seed', 'empty'].includes(String(input.change)))
        return { status: 400, body: { error: 'Choose seed or empty.' } };

    const repo = repos().find((r) => r.repo.startsWith('lar-factory-sample/'))?.repo;

    if (!repo) return { status: 400, body: { error: 'No fake sample repository.' } };

    let record = records.create({
        repository: repo,
        title: 'Finished sample build',
        kind: 'bug',
        status: 'Ready to merge',
    });
    const id = record.workId;

    record = records.setPullRequest(id, record.revision, `${repo}#998`);
    record = records.addThread(id, record.revision, `sample-retro-${id}`, 'build');
    record = records.setBuildPhase(id, record.revision, 'checks');
    record = records.observe(id, record.revision, { of: 'pr', state: 'merged' });
    record = records.update(id, record.revision, { status: 'Done' });

    const retro = records.prepareRetro(id)!;

    retro.delivery.sent = true;
    records.saveRetro(id, retro);
    record = records.setBuildPhase(id, records.read(id).revision, 'retro');
    records.proposeRetro(
        id,
        record.revision,
        input.change === 'empty'
            ? []
            : [
                  {
                      title: 'Explain reviewer evidence in command help',
                      description:
                          'Add a complete example of per-reviewer selection evidence to the local command help so a future build can record its review on the first attempt.',
                      repository: repo,
                      kind: 'improvement',
                  },
                  {
                      title: 'Document a safe retry after a lost response',
                      description:
                          'Explain how the saved request ID finds an existing result before another ticket is created.',
                      repository: repo,
                      kind: 'improvement',
                  },
              ],
    );
    refresh();

    return { status: 200, body: { error: null, workId: id } };
}
