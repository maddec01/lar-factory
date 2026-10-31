// Read-only team discovery for onboarding's setup detection.
import { decodePart, onAzure } from '@lar-factory/shared';
import { az, type Az } from '../azure/azure-items.ts';
import { isRepo } from '../config/repository-config.ts';
import { message } from '../github/github.ts';

export async function readProjectTeams(input: Record<string, unknown>, run: Az = az): Promise<{ teams: string[] } | { status: number; error: string }> {
  if (!isRepo(input.repo) || !onAzure(input.repo)) return { status: 400, error: 'Choose an Azure DevOps repository to load its teams.' };
  const [organization, project] = input.repo.split('/').map(decodePart);
  try {
    const teams = JSON.parse(await run(['devops', 'team', 'list', '--organization', `https://dev.azure.com/${organization}`, '--project', project!, '--output', 'json'])) as { name: string }[];
    return { teams: teams.map((team) => team.name).sort((a, b) => a.localeCompare(b)) };
  } catch (err) { return { status: 502, error: `Can't load teams. ${message(err)}` }; }
}
