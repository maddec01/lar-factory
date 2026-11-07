// The repository select both Add item panes start with, and the hint when none is onboarded.

import { noneOnboarded, repoName } from '@lar-factory/shared';
import { FormSelect } from '@lar-factory/ui/form-select';

import { AddingARepository } from '@/features/notices';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';

export const HINT = 'm-0 text-xs leading-snug text-(--muted-foreground)';

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
                <p className={HINT} id={`${id}-hint`}>
                    No Project is onboarded. <AddingARepository />
                </p>
            )}
        </>
    );
}
