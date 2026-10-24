// The notices for a tool the board can't use: a missing t3 replaces the whole page, and a missing
// or logged-out gh, which stops the board reading GitHub, shows a banner in place of Stale.

import type { ReactNode } from 'react';
import type { ToolMissing, ToolProblem } from '../../../server/src/model.ts';
import { BrandMark } from './Header.tsx';
import { CopyButton } from './CopyButton.tsx';
import { useRecheckStore } from './recheck-store.ts';

const LOOKS_AGAIN = 'The board also looks again every 10 seconds.';

/** The Recheck button and, once a Recheck answered with the notice still up, what it found. */
function Recheck({ problem }: { problem: ToolProblem }) {
  const { checking, answer, recheck } = useRecheckStore();
  const note = answer && !checking ? answer.error ?? (problem.problem === 'logged-out' ? 'Still logged out.' : 'Still not found.') : null;
  return (
    <>
      <button type="button" className="copy recheck" data-recheck disabled={checking} onClick={() => void recheck()}>{checking ? 'Checking…' : 'Recheck'}</button>
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

/** The full-window notice that replaces the board while no t3 is found. */
export function T3Missing({ problem }: { problem: ToolMissing }) {
  return (
    <main className="tool-missing">
      <div className="tool-missing-box" role="alert">
        <h1><BrandMark /><span>T3 Code not found</span></h1>
        <p>
          <Fix problem={problem} tool="t3" what="the T3 Code CLI">
            The board starts threads through T3 Code's <code>t3</code> command and didn't find it on the login shell's PATH, in /opt/homebrew/bin or in /usr/local/bin. Install T3 Code, then press Recheck.
          </Fix>
          {' '}{LOOKS_AGAIN}
        </p>
        <p><Recheck problem={problem} /></p>
      </div>
    </main>
  );
}

/** The banner for a missing or logged-out gh, which stops the board reading GitHub. */
export function GhBanner({ problem }: { problem: ToolProblem }) {
  return (
    <div className="banner" role="alert">
      {problem.problem === 'logged-out'
        ? <><strong>GitHub CLI is logged out.</strong> The board reads the project through <code>gh</code>. Run <CopyableCommand command="gh auth login" /> in a terminal, then press Recheck.</>
        : <><strong>GitHub CLI not found.</strong> The board reads the project through <code>gh</code>. <Fix problem={problem} tool="gh" what="gh">
          Install it with <CopyableCommand command="brew install gh" />, then press Recheck.
        </Fix></>}
      {' '}{LOOKS_AGAIN} <Recheck problem={problem} />
    </div>
  );
}
