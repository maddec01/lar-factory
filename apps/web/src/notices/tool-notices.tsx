// The notices for a failed command check: a missing t3 replaces the main area; T3 Code not running shows a
// banner, as does a gh that's missing, logged out, too old or without the project scope, a missing git, jq or
// curl and an az that fails its check.

import type { ReactNode } from 'react';
import { GH_FLOOR, type AzCheck, type CommandCheck, type FailedCheck, type GhCheck, type T3Check } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { BrandMark } from '@lar-factory/ui/design-system/BrandMark';
import { CopyButton } from '../copy/copy-button.tsx';
import { Banner } from './banner.tsx';
import { useRecheckStore } from './recheck-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

const LOOKS_AGAIN = 'The board also looks again every 10 seconds.';

/** What a Recheck that found the same problem says. */
const STILL: Record<FailedCheck['result'], string> = {
  'missing': 'Still not found.', 'logged-out': 'Still logged out.', 'outdated': `Still older than ${GH_FLOOR}.`,
  'no-extension': 'Still no azure-devops extension.', 'not-running': 'Still not running.',
};

/** The Recheck button and, once a Recheck answered with the notice still up, what it found. */
function Recheck({ check }: { check: FailedCheck }) {
  const { checking, answer, recheck } = useRecheckStore();
  const note = answer && !checking ? answer.error ?? STILL[check.result] : null;
  return (
    <>
      <Button {...kind('other')} className="recheck" data-recheck disabled={checking} onClick={() => void recheck()}>{checking ? 'Checking…' : 'Recheck'}</Button>
      {note && <> <span className="recheck-note" role="status">{note}</span></>}
    </>
  );
}

export function CopyableCommand({ command }: { command: string }) {
  return <><code>{command}</code> <CopyButton text={command} label={`Copy ${command}`} /></>;
}

/** How to fix an override that points at nothing runnable, else the usual fix in `children`. */
function Fix({ check, tool, what, children }: { check: FailedCheck; tool: string; what: string; children: ReactNode }) {
  if (check.result !== 'missing' || !check.override) return children;
  const variable = check.override.split('=')[0]!;
  return <>No runnable <code>{tool}</code> is at <code>{check.override}</code>. Point {variable} at {what} or unset it, then press Recheck.</>;
}

/** The notice that fills the main area while no t3 is found. */
export function T3Missing({ check }: { check: FailedCheck<T3Check> }) {
  return (
    <div className="tool-missing">
      <div className="tool-missing-box" role="alert">
        <BrandMark label="lar" />
        <h1>T3 Code not found</h1>
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

/** The banner while T3 Code isn't running, which stops starts but not the read. */
export function T3NotRunningBanner({ check }: { check: FailedCheck<T3Check> }) {
  return (
    <Banner title="T3 Code is not running.">
      The board starts threads through T3 Code, which has to be open. Open T3 Code, then press Recheck.
      {' '}{LOOKS_AGAIN} <Recheck check={check} />
    </Banner>
  );
}

/** gh's banner title and what to do, by its check's result. */
function ghNotice(check: FailedCheck<GhCheck>): { title: string; body: ReactNode } {
  switch (check.result) {
    case 'missing':
      return { title: 'GitHub CLI not found.', body: <>The board reads GitHub through <code>gh</code>. <Fix check={check} tool="gh" what="gh">
        Install it with <CopyableCommand command={check.fix} />, then press Recheck.
      </Fix></> };
    case 'logged-out':
      return { title: 'GitHub CLI is logged out.', body: <>The board reads GitHub through <code>gh</code>. Run <CopyableCommand command={check.fix} /> in a terminal, then press Recheck.</> };
    case 'outdated':
      return { title: `GitHub CLI is older than ${GH_FLOOR}.`, body: <>lar-work’s scripts need the <code>--parent</code>, <code>--add-sub-issue</code> and <code>--blocked-by</code> flags
        that gh {GH_FLOOR} added, and this gh is {check.version}. Run <CopyableCommand command={check.fix} /> in a terminal, then press Recheck.</> };

  }
}

/** One gh banner, by its check's result. */
function OneGhBanner({ check }: { check: FailedCheck<GhCheck> }) {
  const { title, body } = ghNotice(check);
  return (
    <Banner title={title}>
      {body}
      {/* An old gh doesn't stop the read, so only Recheck looks again. */}
      {check.result !== 'outdated' && <>{' '}{LOOKS_AGAIN}</>} <Recheck check={check} />
    </Banner>
  );
}

/** The banner for a missing, logged-out or outdated gh. */
export function GhBanner({ check }: { check: FailedCheck<GhCheck> }) {
  return <OneGhBanner check={check} />;
}

/** az's banner title by its check's result. */
const AZ_TITLES: Record<FailedCheck<AzCheck>['result'], string> = {
  'missing': 'Azure CLI not found.', 'logged-out': 'Azure CLI is logged out.', 'no-extension': 'Azure CLI has no azure-devops extension.',
};

/** The banner for an az that fails its check, which shows only while a listed repository is on Azure DevOps and never stops the read. */
export function AzBanner({ check }: { check: FailedCheck<AzCheck> }) {
  return (
    <Banner title={AZ_TITLES[check.result]}>
      The board reads repositories on Azure DevOps through <code>az</code>.{' '}
      {check.result === 'missing'
        ? <Fix check={check} tool="az" what="az">Install it with <CopyableCommand command={check.fix} />, then press Recheck.</Fix>
        : <>Run <CopyableCommand command={check.fix} /> in a terminal, then press Recheck.</>}
      {' '}<Recheck check={check} />
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
export function CommandBanner({ name, check }: { name: Command; check: FailedCheck<CommandCheck> }) {
  const { fix: install, override } = check;
  return (
    <Banner title={`${name} not found.`}>
      {COMMAND_USES[name]} <code>{name}</code>.{' '}
      {override
        ? <>No runnable <code>{name}</code> is at <code>{override}</code>. Point {override.split('=')[0]} at {name}, or unset it and install it</>
        : <>Install it</>}
      {' '}with <CopyableCommand command={install} />, then press Recheck.
      {' '}<Recheck check={check} />
    </Banner>
  );
}
