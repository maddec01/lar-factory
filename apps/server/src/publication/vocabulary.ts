import { readAzureVocabulary, readPublicationSettings, type PublicationSettings, type VocabularyReads } from '@lar-factory/shared/publication-settings';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { az } from '../azure/azure-items.ts';
import { onAzure } from '@lar-factory/shared';
import { readBranchFile as readAzureFile } from '../azure/azure-repos.ts';
import { githubJson, readBranchFile } from '../github/github.ts';
import { isRepo } from '../config/repository-config.ts';
import { notEditable, type Refused } from '../config/edit-config.ts';

/** Reads metadata through the board's authenticated transports, without probe writes. */
export async function publicationVocabulary(repo: unknown, dir = boardDataDir(), reads: VocabularyReads = {
  github: githubJson, azure: (repo, resource) => readAzureVocabulary(repo, resource, az), sharedConfig: (key) => (onAzure(key) ? readAzureFile : readBranchFile)(key, '.lar-factory.json'),
}): Promise<PublicationSettings | Refused> {
  if (!isRepo(repo)) return { status: 400, error: 'Name the repository whose Vocabulary to read.' };
  const refused = notEditable(repo, dir);
  if (refused) return refused;
  return readPublicationSettings(repo, { dir, reads });
}
