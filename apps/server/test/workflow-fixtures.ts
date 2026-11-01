// Disposable repositories for the workflow boundary: each exists only as fake gh or az state and a temporary
// checkout, so no test reads or writes a real repository. workflow-checks.md lists what they can't prove.

import type { Checkout } from '../src/t3/repository-project.ts';

/** A GitHub repository with no factory files: no .lar-factory.json, no Agent skills section, no docs/agents/ and no domain docs. */
export const NO_FACTORY_FILES = {
  repo: 'example-owner/example-web',
  origin: 'git@github.com:example-owner/example-web.git',
  files: ['README.md', 'package.json', 'src/index.ts'],
} as const;

/**
 * A repository with existing project rules: on Azure DevOps, with project guidance of its own beside the factory files an earlier setup
 * left, and a project skill. Its files are keyed by path from the root, as fakeAzRepos takes them.
 */
export const AZURE_WITH_PROJECT_RULES = {
  repo: 'contoso/Fabrikam%20Fiber/lar-api',
  checkout: { id: 'example-app', title: 'Example App', folder: '/Users/me/Developer/Example App',
    origin: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/lar-api' } satisfies Checkout,
  files: {
    '/README.md': '# Example App\n',
    '/CLAUDE.md': '@AGENTS.md\n',
    '/AGENTS.md': '# Example App\n\nRun `dotnet test` before every PR.\nPR titles start with the work item number, as in `AB#123 Fix login`.\n\n'
      + '## Agent skills\n\nUse lar-shape and lar-build.\n\n## Release\n\nRelease from the release branch only.\n',
    '/docs/agents/issue-tracker.md': '# Issue tracker\n\nAzure Boards, tagged `repo-example-app`.\n',
    '/.claude/skills/example-app-review/SKILL.md': '---\nname: example-app-review\ndescription: Review Example App changes.\n---\n',
    '/src/App.cs': 'class App {}\n',
  },
} as const;
