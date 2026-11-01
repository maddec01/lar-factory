// Test sessions can read Azure DevOps while refusing every provider mutation and agent launch.
import { onAzure } from './model.ts';

type Environment = Readonly<Record<string, string | undefined>>;
const refusal = 'Azure DevOps is read-only in this test session.';

/** Kept in the environment so the board and lar-work subprocesses share the same boundary. */
function readOnly(env: Environment): boolean {
  return env.LAR_FACTORY_AZURE_READ_ONLY === '1';
}

/** Read one CLI option, refusing duplicates and alternate spellings instead of guessing which az will use. */
function option(args: readonly string[], name: string): string | undefined {
  const values = args.flatMap((arg, i) => arg === name ? [args[i + 1] ?? ''] : arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []);
  if (values.length > 1 || values.some((value) => !value || value.startsWith('-'))) throw new Error(refusal);
  return values[0];
}

const READ_RESOURCES: Readonly<Record<string, readonly string[]>> = {
  git: ['items', 'commits', 'trees', 'blobs', 'pullRequests', 'pullRequestStatuses', 'pullRequestReviewers'],
  wit: ['workitemsbatch', 'wiql', 'comments', 'tags', 'workitemtypes', 'workitemtypestates', 'workitemrelationtypes'],
  work: ['backlogconfiguration', 'backlogs', 'teamfieldvalues'],
  policy: ['evaluations'],
};

// Azure accepts abbreviated options. Only exact spellings can be checked safely here.
const READ_OPTIONS = new Set(['--area', '--resource', '--http-method', '--method', '--url', '--api-version',
  '--route-parameters', '--query-parameters', '--in-file', '--organization', '--org', '--project', '--repository',
  '--id', '--filter', '--team', '--timeframe', '--status', '--detect', '--output', '--name', '--query', '--version']);

/** Fail closed before any az process starts. POST is allowed only for Azure's two read APIs. */
export function assertAzureCommandAllowed(args: readonly string[], env: Environment = process.env): void {
  if (!readOnly(env)) return;
  if (args.some(arg => arg.startsWith('-') && !READ_OPTIONS.has(arg.split('=')[0]!))) throw new Error(refusal);
  const command = args.slice(0, 4).join(' ');
  if (args.some((arg) => arg === '-m' || arg === '--uri')) throw new Error(refusal);
  const method = option(args, '--http-method');
  const restMethod = option(args, '--method');
  if (args[0] === 'devops' && args[1] === 'invoke') {
    const area = option(args, '--area');
    const resource = option(args, '--resource');
    const verb = (method ?? 'GET').toUpperCase();
    if (!restMethod && !args.some((arg) => arg === '--url' || arg.startsWith('--url=')) && area && resource && READ_RESOURCES[area]?.includes(resource)
      && (verb === 'GET' && !args.some((arg) => arg === '--in-file' || arg.startsWith('--in-file='))
        || verb === 'POST' && area === 'wit' && ['workitemsbatch', 'wiql'].includes(resource))) return;
  } else if (args[0] === 'rest') {
    const url = option(args, '--url');
    if (!method && restMethod?.toUpperCase() === 'GET' && url) {
      const parsed = URL.canParse(url) ? new URL(url) : null;
      // Only the board's evaluated-permission and repository metadata reads are allowed.
      if (parsed?.protocol === 'https:' && parsed.hostname === 'dev.azure.com' && !parsed.username && !parsed.password
        && (/^\/[^/]+\/_apis\/permissions\/[a-f0-9-]+\/\d+$/i.test(parsed.pathname)
          || /^\/[^/]+\/_apis\/securitynamespaces$/i.test(parsed.pathname)
          || /^\/[^/]+\/[^/]+\/_apis\/wit\/classificationnodes\/areas$/i.test(parsed.pathname))) return;
    }
  } else if (!method && !restMethod && (
    args.length === 1 && args[0] === 'version'
    || args[0] === '--version' && args.length === 1
    || ['account show', 'extension show'].includes(args.slice(0, 2).join(' '))
    || ['devops team list', 'devops team list-member'].includes(args.slice(0, 3).join(' '))
    || args.slice(0, 3).join(' ') === 'repos ref list'
    || args.slice(0, 2).join(' ') === 'repos show'
    || ['repos pr show', 'repos pr list'].includes(args.slice(0, 3).join(' '))
    || ['repos pr policy list', 'repos pr work-item list', 'boards iteration team list', 'boards iteration team list-work-items'].includes(command)
  )) return;
  throw new Error(refusal);
}

/** An agent can run git or az outside board transports, so read-only Azure sessions cannot launch one. */
export function assertAzureThreadAllowed(repository: string, env: Environment = process.env): void {
  if (readOnly(env) && onAzure(repository)) throw new Error(`${refusal} Agent threads cannot start.`);
}
