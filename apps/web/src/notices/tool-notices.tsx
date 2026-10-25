// The notices for a tool the board can't use: a missing t3 replaces the main area, and a missing
// or logged-out gh, which stops the board reading GitHub, shows a banner.

import type { ReactNode } from 'react';
import type { ToolMissing, ToolProblem } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/button';
import { BrandMark } from '../brand/brand-mark.tsx';
import { CopyButton } from '../copy/copy-button.tsx';
import { Banner } from './banner.tsx';
import { useRecheckStore } from './recheck-store.ts';

const LOOKS_AGAIN = 'The board also looks again every 10 seconds.';

/** The Recheck button and, once a Recheck answered with the notice still up, what it found. */
function Recheck({ problem }: { problem: ToolProblem }) {
  const { checking, answer, recheck } = useRecheckStore();
  const note = answer && !checking ? answer.error ?? (problem.problem === 'logged-out' ? 'Still logged out.' : 'Still not found.') : null;
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
function Fix({ problem, tool, what, children }: { problem: ToolProblem; tool: string; what: string; children: ReactNode }) {
  if (problem.problem !== 'missing' || !problem.override) return children;
  const variable = problem.override.split('=')[0]!;
  return <>No runnable <code>{tool}</code> is at <code>{problem.override}</code>. Point {variable} at {what} or unset it, then press Recheck.</>;
}

/** The notice that fills the main area while no t3 is found. */
export function T3Missing({ problem }: { problem: ToolMissing }) {
  return (
    <div className="tool-missing">
      <div className="tool-missing-box" role="alert">
        <h1><BrandMark className="brand-mark" label="lar" /><span>T3 Code not found</span></h1>
        <p>
          <Fix problem={problem} tool="t3" what="the T3 Code CLI">
            The board starts threads through T3 Code's <code>t3</code> command and didn't find it on the login shell's PATH, in /opt/homebrew/bin or in /usr/local/bin. Install T3 Code, then press Recheck.
          </Fix>
          {' '}{LOOKS_AGAIN}
        </p>
        <p><Recheck problem={problem} /></p>
      </div>
    </div>
  );
}

/** The banner for a missing or logged-out gh, which stops the board reading GitHub. */
export function GhBanner({ problem }: { problem: ToolProblem }) {
  return (
    <Banner title={problem.problem === 'logged-out' ? 'GitHub CLI is logged out.' : 'GitHub CLI not found.'}>
      {problem.problem === 'logged-out'
        ? <>The board reads the project through <code>gh</code>. Run <CopyableCommand command="gh auth login" /> in a terminal, then press Recheck.</>
        : <>The board reads the project through <code>gh</code>. <Fix problem={problem} tool="gh" what="gh">
          Install it with <CopyableCommand command="brew install gh" />, then press Recheck.
        </Fix></>}
      {' '}{LOOKS_AGAIN} <Recheck problem={problem} />
    </Banner>
  );
}
