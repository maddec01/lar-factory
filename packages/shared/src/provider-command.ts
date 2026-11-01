// Node-only transport shared by publication settings and writes. Uses the local CLI login; never retries.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAzureCommandAllowed } from './azure-safety.ts';

export async function providerCommand(command: 'gh' | 'az', args: string[], input?: string): Promise<string> {
  if (command === 'az') assertAzureCommandAllowed(args);
  return new Promise((resolve, reject) => {
    const child = execFile(process.env[command === 'gh' ? 'GH_PATH' : 'AZ_PATH'] || command, args,
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          // Do not include execFile's command line: it may contain private content.
          const failure = new Error(`${command} failed: ${stderr.trim() || error.code || 'lost response'}`);
          reject(failure);
        } else resolve(stdout);
      });
    child.stdin?.on('error', () => { /* execFile's completion owns a lost pipe. */ });
    child.stdin?.end(input);
  });
}

/**
 * The REST API version every `az devops invoke` call passes, as invoke's own default is 5.0. invoke reads it as a
 * number, so a preview call passes `7.2-preview` and az adds the server's resource version: `7.2-preview.1` fails as 7.2.1.
 */
export const API_VERSION = '7.1';
/** The Entra resource of Azure DevOps, which az rest gets its token for. */
export const DEVOPS_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';

/**
 * The `az rest` arguments that PATCH the work item `id` in `project` of `organization` with the JSON patch in `file`.
 * az devops invoke can't: of wit/workitems' two routes, ${type} to create and {id}, it always takes the first.
 */
export const workItemPatch = (organization: string, project: string, id: number, file: string, version = API_VERSION): string[] => ['rest', '--method', 'patch',
  '--resource', DEVOPS_RESOURCE, '--url', `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}?api-version=${version}`,
  '--headers', 'Content-Type=application/json-patch+json', '--body', `@${file}`, '--output', 'json'];
/** Runs `use` on a temporary file holding `body` as JSON, for az's --in-file, and removes the file after. */
export async function withFile<T>(body: unknown, use: (file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lar-azure-'));
  try {
    const file = join(dir, 'body.json');
    await writeFile(file, JSON.stringify(body));
    return await use(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
