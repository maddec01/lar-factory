// The setup fields' answers: the show setting suggested for an item source, giving an answer, and what each answer
// that Next or Save waits for needs. Onboarding's Provider and item source step and Edit both use them.

import type { RepositoryItemSource, SetupAnswers, ShowSetting } from '@lar-factory/shared';

/** The button that waits for the answers: Next in onboarding, Save in Edit. */
export type SetupAction = 'Next' | 'Save';

/** A change to the answers, as a setup field gives it; picking a show setting is what sets `showPicked`. */
export type SetupChange = Partial<Omit<SetupAnswers, 'showPicked'>>;

/** All available work shows by default on either hosting service. */
export const suggestedShow = (): ShowSetting => 'all';

/** Whether an item source is an Azure DevOps team's, so it is named by its team. */
export const byTeam = (itemSource: SetupAnswers['itemSource']): itemSource is 'azure-board' =>
  itemSource === 'azure-board';

/** The answers with `change` given: a picked show setting stays, and until one is picked a new item source takes its suggested one. */
export function answerSetup(setup: SetupAnswers, change: SetupChange): SetupAnswers {
  const answered = { ...setup, ...change };
  if (change.show) answered.showPicked = true;
  else if (change.itemSource && !answered.showPicked) answered.show = suggestedShow();
  return answered;
}

/** The answers Next or Save needs: a role, and the team on Azure DevOps. */
export function setupProblems(setup: SetupAnswers, action: SetupAction = 'Next'): Partial<Record<'team' | 'role', string>> {
  return {
    ...byTeam(setup.itemSource) && !setup.team?.trim() && { team: `Choose a team to continue with ${action}.` },
    ...!setup.role.trim() && { role: `Describe what this repository does to continue with ${action}.` },
  };
}

/** The item source the answers name, once setupProblems finds nothing in them. */
export const setupItemSource = (setup: SetupAnswers): RepositoryItemSource => byTeam(setup.itemSource) ? { kind: setup.itemSource, team: setup.team!.trim() }
  : { kind: 'issues' };

/** Why onboarding starts with fresh answers instead of reusing an invalid file. */
export const REPLACE_SETTINGS_HELP = "Its settings file can't be used. Run onboarding to replace it.";
