// What removing work's old branches and worktrees would lose, in a confirmation.

/** Each branch with the files and commits deleting it would lose, as a grouped list. */
export function LossList({
    branches,
}: {
    /** Each branch with what deleting it would lose. */
    branches: { name: string; losses: string[] }[];
}) {
    return (
        <ul className="m-0 grid list-none gap-3 p-0 wrap-anywhere">
            {branches.map((branch) => (
                <li key={branch.name} className="grid gap-1">
                    <span className="font-mono text-xs font-medium">{branch.name}</span>
                    <ul className="m-0 grid list-disc gap-1 ps-4 text-xs">
                        {branch.losses.map((loss) => (
                            <li key={loss}>{loss}</li>
                        ))}
                    </ul>
                </li>
            ))}
        </ul>
    );
}
