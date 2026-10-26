// The notices for a failed command check: a missing t3 replaces the main area, a missing or logged-out
// gh, which stops the board reading GitHub, shows a banner, and so does a missing git, jq or curl.

import type { ReactNode } from 'react';
import type { FailedCheck } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/button';
import { BrandMark } from '../brand/brand-mark.tsx';
import { CopyButton } from '../copy/copy-button.tsx';
import { Banner } from './banner.tsx';
import { useRecheckStore } from './recheck-store.ts';

const LOOKS_AGAIN = 'The board also looks again every 10 seconds.';

/** The Recheck button and, once a Recheck answered with the notice still up, what it found. */
function Recheck({ check }: { check: FailedCheck }) {
  const { checking, answer, recheck } = useRecheckStore();
  const note = answer && !checking ? answer.error ?? (check.result === 'logged-out' ? 'Still logged out.' : 'Still not found.') : null;
  return (
    <>
      <Button variant="outline" size="xs" className="recheck" data-recheck disabled={checking} onClick={() => void recheck()}>{checking ? 'Checking…' : 'Recheck'}</Button>
      {note && <> <span className="recheck-note" role="status">{note}</span></>}
    </>
  );
}

function CopyableCommand({ command }: { command: string }) {
  return <><code>{command}</code> <CopyButton text={command} label={`Copy ${command}`} /></>;
}

/** How to fix an override that points at nothing runnable, else the usual fix in `children`. */
function Fix({ check, tool, what, children }: { check: FailedCheck; tool: string; what: string; children: ReactNode }) {
  if (check.result !== 'missing' || !check.override) return children;
  const variable = check.override.split('=')[0]!;
  return <>No runnable <code>{tool}</code> is at <code>{check.override}</code>. Point {variable} at {what} or unset it, then press Recheck.</>;
}

/** The notice that fills the main area while no t3 is found. */
export function T3Missing({ check }: { check: FailedCheck }) {
  return (
    <div className="tool-missing">
      <div className="tool-missing-box" role="alert">
        <h1><BrandMark className="brand-mark" label="lar" /><span>T3 Code not found</span></h1>
        <p>
          <Fix check={check} tool="t3" what="the T3 Code CLI">
            The board starts threads through T3 Code's <code>t3</code> command and didn't find it on the login shell's PATH, in /opt/homebrew/bin or in /usr/local/bin. Install T3 Code, then press Recheck.
          </Fix>
          {' '}{LOOKS_AGAIN}
        </p>
        <p><Recheck check={check} /></p>
      </div>
    </div>
  );
}

/** The banner for a missing or logged-out gh, which stops the board reading GitHub. */
export function GhBanner({ check }: { check: FailedCheck }) {
  return (
    <Banner title={check.result === 'logged-out' ? 'GitHub CLI is logged out.' : 'GitHub CLI not found.'}>
      {check.result === 'logged-out'
        ? <>The board reads the project through <code>gh</code>. Run <CopyableCommand command="gh auth login" /> in a terminal, then press Recheck.</>
        : <>The board reads the project through <code>gh</code>. <Fix check={check} tool="gh" what="gh">
          Install it with <CopyableCommand command="brew install gh" />, then press Recheck.
        </Fix></>}
      {' '}{LOOKS_AGAIN} <Recheck check={check} />
    </Banner>
  );
}

/** What lar-work does with each command whose check is a banner of its own. */
const COMMAND_USES = {
  git: 'lar-work’s agents branch, commit and push with',
  jq: 'lar-work’s scripts read gh’s answers with',
  curl: 'lar-work’s scripts tell the board to refresh with',
} as const;
export type Command = keyof typeof COMMAND_USES;

/** The banner for a missing git, jq or curl, which the board reads without. */
export function CommandBanner({ name, check }: { name: Command; check: FailedCheck }) {
  const install = check.result === 'missing' ? check.fix : undefined;
  const override = check.result === 'missing' ? check.override : undefined;
  return (
    <Banner title={`${name} not found.`}>
      {COMMAND_USES[name]} <code>{name}</code>.{' '}
      {override
        ? <>No runnable <code>{name}</code> is at <code>{override}</code>. Point {override.split('=')[0]} at {name}, or unset it and install it</>
        : <>Install it</>}
      {install && <> with <CopyableCommand command={install} /></>}, then press Recheck.
      {' '}{LOOKS_AGAIN} <Recheck check={check} />
    </Banner>
  );
}
