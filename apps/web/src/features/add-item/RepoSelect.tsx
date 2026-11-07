// The repository select both Add item panes start with, and the hint when none is onboarded.

import { noneOnboarded, repoName } from '@lar-factory/shared';
import { BoardNote, FormSelect } from '@lar-works/design-system';

import { AddingARepository } from '@/features/notices';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';

/** The repository select both panes start with, and the hint when none is onboarded. */
export function RepoSelect({ id, repo, onRepo }: { id: string; repo: string; onRepo: (repo: string) => void }) {
    const data = useBoardStore((state) => state.data);
    const hint = noneOnboarded(data);

    return (
        <>
            <FormSelect
                id={id}
                name="repo"
                value={repo}
                onChange={onRepo}
                aria-describedby={hint ? `${id}-hint` : undefined}
                choices={data.repos.map((r) => ({
                    value: r.repo,
                    name: repoName(r.repo, data.repos),
                    icon: <ProjectIcon repo={r.repo} size="small" />,
                }))}
            />
            {hint && (
                <BoardNote id={`${id}-hint`}>
                    No Project is onboarded. <AddingARepository />
                </BoardNote>
            )}
        </>
    );
}
