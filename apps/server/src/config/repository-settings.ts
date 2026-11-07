import {
    SHARED_SETTINGS,
    writeAccessProblem,
    sameRepo,
    type RepositorySetup,
    type RepositoryConfigProblem,
    type SharedSetting,
    type SharedRepositorySettings,
} from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import {
    discoverVocabulary,
    saveVocabularyLabels,
    type VocabularyReads,
} from '@lar-factory/shared/publication-settings';
import { setVocabularyOverride } from '@lar-factory/shared/repository-settings';
import { readRepositorySetups, setOverride, replaceAccess } from '@lar-factory/shared/repository-settings';
import {
    isVocabularyMapping,
    vocabularySelectionProblem,
    VOCABULARY_KEYS,
    type VocabularyKey,
    type VocabularySettingsResponse,
} from '@lar-factory/shared/vocabulary';

import { detectAccess } from '../onboarding/detect-setup.ts';
export {
    readRepositorySetups,
    saveLocalSetup,
    setOverride,
    validateRepositorySettings,
} from '@lar-factory/shared/repository-settings';
import { notEditable, type Refused } from './editable-repository.ts';
import { isRepo, onTheBoard, type OnboardedRepository, type RepositoryConfig } from './repository-config.ts';

/** Changes local values or reads the signed-in account's access again. */
export async function changeRepositorySettings(
    input: Record<string, unknown>,
    dir = boardDataDir(),
    reads?: VocabularyReads,
    create?: (repo: string, name: string) => Promise<string>,
): Promise<VocabularySettingsResponse | Refused> {
    const { repo, change, key, value } = input;
    if (
        !isRepo(repo) ||
        !['override', 'recheck', 'structure-sync', 'vocabulary', 'discover-vocabulary'].includes(change as string)
    ) {
        return { status: 400, error: 'Send the Project and the change to its settings.' };
    }
    if (change === 'override' && !SHARED_SETTINGS.includes(key as SharedSetting))
        return { status: 400, error: 'Choose a Project setting.' };
    const refused = notEditable(repo, dir);
    if (refused) return refused;
    try {
        if (change === 'discover-vocabulary')
            return {
                setup: readRepositorySetups(dir).find((s) => sameRepo(s.repo, repo))!,
                discovery: await discoverVocabulary(repo, reads),
            };
        if (change === 'vocabulary') {
            if (!VOCABULARY_KEYS.includes(key as VocabularyKey) || !isVocabularyMapping({ [key as string]: value }))
                throw new Error('Choose a vocabulary kind and its existing type and labels, or none.');
            const discovery = await discoverVocabulary(repo, reads);
            const term = value as { type: string | null; labels: string[] };
            const problem = vocabularySelectionProblem(term, discovery);
            if (problem) throw new Error(problem);
            const setup = readRepositorySetups(dir).find((s) => sameRepo(s.repo, repo))!;
            for (const operation of [
                ...(term.type === null ? [] : ['type-ticket' as const]),
                ...(term.labels.length ? ['tag-ticket' as const] : []),
            ]) {
                const problem = writeAccessProblem(repo, operation, setup.access);
                if (problem) throw new Error(problem);
            }
            const labels = await saveVocabularyLabels(repo, input.newLabels ?? [], discovery, setup.access, create);
            setVocabularyOverride(
                repo,
                key as VocabularyKey,
                { ...term, labels: [...new Set([...term.labels, ...labels])] },
                dir,
            );
        } else if (change === 'recheck') replaceAccess(repo, await detectAccess(repo), dir);
        else if (change === 'structure-sync') {
            throw new Error(
                'Legacy structural publication is suspended. Local content and prior settings are retained.',
            );
        } else setOverride(repo, key as SharedSetting, value as SharedRepositorySettings[SharedSetting], dir);
    } catch (err) {
        return { status: 400, error: (err as Error).message };
    }
    return { setup: readRepositorySetups(dir).find((s) => sameRepo(s.repo, repo))! };
}

/** The repository list and settings come only from this machine. */
export interface OnboardedConfigs {
    configs: RepositoryConfig[];
    setups: RepositorySetup[];
    problems: RepositoryConfigProblem[];
}

export async function readOnboardedConfigs(
    list: readonly OnboardedRepository[],
    _run?: (args: string[]) => Promise<string>,
    dir = boardDataDir(),
): Promise<OnboardedConfigs> {
    const settings = readRepositorySetups(dir);
    const configs: RepositoryConfig[] = [];
    const setups: RepositorySetup[] = [];
    const problems: RepositoryConfigProblem[] = [];
    for (const { repo } of onTheBoard(list)) {
        const setup = settings.find((s) => sameRepo(s.repo, repo));
        if (!setup?.itemSource) {
            problems.push({ repo, problem: 'Choose the team whose work appears in the list.' });
            continue;
        }
        configs.push({ repo, role: setup.role, itemSource: setup.itemSource, labels: setup.labels });
        setups.push(setup);
    }
    return { configs, setups, problems };
}
