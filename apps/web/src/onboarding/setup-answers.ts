// The setup fields' answers: the show setting suggested for an item source, giving an answer, and what each answer
// that Next or Save waits for needs. Onboarding's Provider and item source step and Edit both use them.

import type { RepositoryItemSource, SetupAnswers, ShowSetting } from '@lar-factory/shared';

/** The button that waits for the answers: Next in onboarding, Save in Edit. */
export type SetupAction = 'Next' | 'Save';

/** A change to the answers, as a setup field gives it; picking a show setting is what sets `showPicked`. */
export type SetupChange = Partial<Omit<SetupAnswers, 'showPicked'>>;

/**
 * The show setting suggested for an item source: All items for a GitHub Project or an Azure DevOps sprint, Opted-in
 * items for issues or an Azure DevOps backlog.
 */
export const suggestedShow = (itemSource: SetupAnswers['itemSource']): ShowSetting =>
  itemSource === 'github-project' || itemSource === 'azure-sprint' ? 'all' : 'opted-in';

/** Whether an item source is an Azure DevOps team's, so it is named by its team. */
export const byTeam = (itemSource: SetupAnswers['itemSource']): itemSource is 'azure-sprint' | 'azure-backlog' | 'azure-board' =>
  itemSource === 'azure-sprint' || itemSource === 'azure-backlog' || itemSource === 'azure-board';

/** The answers with `change` given: a picked show setting stays, and until one is picked a new item source takes its suggested one. */
export function answerSetup(setup: SetupAnswers, change: SetupChange): SetupAnswers {
  const answered = { ...setup, ...change };
  if (change.show) answered.showPicked = true;
  else if (change.itemSource && !answered.showPicked) answered.show = suggestedShow(change.itemSource);
  return answered;
}

/** A GitHub login, as .lar-factory.json's itemSource.owner takes it. */
const GITHUB_LOGIN = /^[A-Za-z0-9](-?[A-Za-z0-9])*$/;

/**
 * What each answer `action` waits for needs: a role, for a GitHub Project its owner and a positive whole number, and
 * for an Azure DevOps sprint or backlog its team.
 */
export function setupProblems(setup: SetupAnswers, action: SetupAction = 'Next'): Partial<Record<'projectOwner' | 'projectNumber' | 'team' | 'role', string>> {
  const project = setup.itemSource === 'github-project';
  return {
    ...project && !GITHUB_LOGIN.test(setup.projectOwner) && { projectOwner: `Enter a GitHub username or organization name to continue with ${action}.` },
    ...project && !/^[1-9]\d*$/.test(setup.projectNumber) && { projectNumber: `Enter a project number greater than zero to continue with ${action}.` },
    ...byTeam(setup.itemSource) && !setup.team?.trim() && { team: `Enter the team name to continue with ${action}.` },
    ...!setup.role.trim() && { role: `Describe what this repository does to continue with ${action}.` },
  };
}

/** The item source the answers name, once setupProblems finds nothing in them. */
export const setupItemSource = (setup: SetupAnswers): RepositoryItemSource => byTeam(setup.itemSource) ? { kind: setup.itemSource, team: setup.team!.trim() }
  : setup.itemSource === 'issues' ? { kind: 'issues' } : { kind: 'github-project', owner: setup.projectOwner, number: Number(setup.projectNumber) };
