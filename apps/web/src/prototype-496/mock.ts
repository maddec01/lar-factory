// PROTOTYPE #496, throwaway: mock data for both dialogs.

export const REPOS = [
  { repo: 'maddec01/lar', name: 'lar', labels: ['app: music', 'app: video', 'os: ios', 'os: macos', 'area: server', 'UI', 'Review'] },
  { repo: 'maddec01/lar-factory', name: 'lar-factory', labels: ['area: board', 'area: skills', 'UI'] },
  // An Azure repository, for the "Only for" checkbox.
  { repo: 'contoso/payments', name: 'payments', labels: ['area: api', 'area: web', 'Review'], azure: { team: 'Payments' } },
] as { repo: string; name: string; labels: string[]; azure?: { team: string } }[];

export const KINDS = ['Feature', 'Bug', 'Chore'];

export const ITEM = {
  ref: '#412',
  title: 'Resume playback where the user left off',
  labels: ['app: music', 'os: ios'],
  description: `When the app reopens, playback should pick up where it stopped.

## Steps
1. Play a track for a minute
2. Quit the app
3. Reopen it

## Expected
- The same track is selected
- The position is **kept** to the second
  - Even after a reboot

See \`PlayerState\` in the server.`,
};

/** Labels grouped by the text before ": "; unprefixed labels last, in one section with no heading. */
export function groupLabels(labels: readonly string[]) {
  const groups = new Map<string, { label: string; text: string }[]>();
  const plain: { label: string; text: string }[] = [];
  for (const label of labels) {
    const at = label.indexOf(': ');
    if (at < 0) plain.push({ label, text: label });
    else {
      const prefix = label.slice(0, at);
      groups.set(prefix, [...(groups.get(prefix) ?? []), { label, text: label.slice(at + 2) }]);
    }
  }
  return [...[...groups].map(([prefix, options]) => ({ prefix, options })), ...(plain.length ? [{ prefix: '', options: plain }] : [])];
}
