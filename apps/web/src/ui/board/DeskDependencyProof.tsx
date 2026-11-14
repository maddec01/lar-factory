/** The external proof Pedro must accept, beside the waiting build's title. */
export function DeskDependencyProof({ proofs }: { proofs: { dependencyId: string; owner: string; need: string }[] }) {
    return (
        <div className="grid gap-1 text-xs">
            {proofs.map((proof) => (
                <p key={proof.dependencyId} className="text-fg-muted wrap-anywhere">
                    {proof.owner}: {proof.need}
                </p>
            ))}
        </div>
    );
}
