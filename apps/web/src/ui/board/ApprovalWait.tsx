/** The desk names the T3 request owner and its user-facing prompt. */
export function ApprovalWait({ owner, summary }: { owner: string; summary?: string }) {
    return (
        <div className="grid gap-1 text-xs">
            <p className="text-fg-muted break-words">Thread: {owner}</p>
            {summary && <p className="text-fg break-words">{summary}</p>}
        </div>
    );
}
