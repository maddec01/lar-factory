// Disposable repositories for the workflow boundary: each exists only as fake gh or az state and a temporary
// checkout, so no test reads or writes a real repository. workflow-checks.md lists what they can't prove.

import type { Checkout } from '../src/t3/repository-project.ts';

/** A GitHub repository with no factory files: no .lar-factory.json, no Agent skills section, no docs/agents/ and no domain docs. */
export const NO_FACTORY_FILES = {
  repo: 'maddec01/lar-web',
  origin: 'git@github.com:maddec01/lar-web.git',
  files: ['README.md', 'package.json', 'src/index.ts'],
} as const;

/**
 * A repository like IApp: on Azure DevOps, with project guidance of its own beside the factory files an earlier setup
 * left, and a project skill. Its files are keyed by path from the root, as fakeAzRepos takes them.
 */
export const IAPP_LIKE = {
  repo: 'contoso/Fabrikam%20Fiber/lar-api',
  checkout: { id: 'iapp', title: 'IApp', folder: '/Users/me/Developer/IApp',
    origin: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/lar-api' } satisfies Checkout,
  files: {
    '/README.md': '# IApp\n',
    '/CLAUDE.md': '@AGENTS.md\n',
    '/AGENTS.md': '# IApp\n\nRun `dotnet test` before every PR.\nPR titles start with the work item number, as in `AB#123 Fix login`.\n\n'
      + '## Agent skills\n\nUse lar-shape and lar-build.\n\n## Release\n\nRelease from the release branch only.\n',
    '/docs/agents/issue-tracker.md': '# Issue tracker\n\nAzure Boards, tagged `repo-iapp`.\n',
    '/.claude/skills/iapp-review/SKILL.md': '---\nname: iapp-review\ndescription: Review IApp changes.\n---\n',
    '/src/App.cs': 'class App {}\n',
  },
} as const;
