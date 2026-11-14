/** Notes guide implementation; sibling approvals depend on the declared delivery contract. */
export function contractText(brief: string): string {
    let notes = false;

    return brief
        .split('\n')
        .filter((line) => {
            if (/^##\s+/.test(line)) notes = /^##\s+Notes(?:\s|$)/i.test(line);

            return !notes;
        })
        .join('\n')
        .trim();
}

/** References are stable work IDs, including Markdown links and backtick declarations. */
export function cites(text: string, workId: string, title = ''): boolean {
    const alias = /^([A-Za-z]\d+)(?=\W|$)/.exec(title)?.[1];

    return (
        text.includes(workId) ||
        (title.length > 3 && text.includes(title)) ||
        !!(alias && new RegExp(`\\b${alias}\\b`).test(text))
    );
}
