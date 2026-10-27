// The setup fields' answers: the show setting suggested for an item source, giving an answer, and what each answer
// that Next or Save waits for needs. Onboarding's Provider and item source step and Edit both use them.

import type { SetupAnswers, ShowSetting } from '@lar-factory/shared';

/** The button that waits for the answers: Next in onboarding, Save in Edit. */
export type SetupAction = 'Next' | 'Save';

/** A change to the answers, as a setup field gives it; picking a show setting is what sets `showPicked`. */
export type SetupChange = Partial<Omit<SetupAnswers, 'showPicked'>>;

/** The show setting suggested for an item source: All items for a GitHub Project, Opted-in items for issues. */
export const suggestedShow = (itemSource: SetupAnswers['itemSource']): ShowSetting => itemSource === 'github-project' ? 'all' : 'opted-in';

/** The answers with `change` given: a picked show setting stays, and until one is picked a new item source takes its suggested one. */
export function answerSetup(setup: SetupAnswers, change: SetupChange): SetupAnswers {
  const answered = { ...setup, ...change };
  if (change.show) answered.showPicked = true;
  else if (change.itemSource && !answered.showPicked) answered.show = suggestedShow(change.itemSource);
  return answered;
}

/** A GitHub login, as .lar-factory.json's itemSource.owner takes it. */
const GITHUB_LOGIN = /^[A-Za-z0-9](-?[A-Za-z0-9])*$/;

/** What each answer `action` waits for needs: a role, and for a GitHub Project its owner and a positive whole number. */
export function setupProblems(setup: SetupAnswers, action: SetupAction = 'Next'): Partial<Record<'projectOwner' | 'projectNumber' | 'role', string>> {
  const project = setup.itemSource === 'github-project';
  return {
    ...project && !GITHUB_LOGIN.test(setup.projectOwner) && { projectOwner: `${action} needs a GitHub login: letters, digits and single hyphens, not at either end.` },
    ...project && !/^[1-9]\d*$/.test(setup.projectNumber) && { projectNumber: `${action} needs the number, a positive whole number like 3.` },
    ...!setup.role.trim() && { role: `${action} needs the repository’s role.` },
  };
}
