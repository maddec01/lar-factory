// Disposable repositories for the workflow boundary: each exists only as fake gh or az state and a temporary
// checkout, so no test reads or writes a real repository.

/** A GitHub repository with no factory files: no .lar-factory.json, no Agent skills section, no docs/agents/ and no domain docs. */
export const NO_FACTORY_FILES = {
    repo: 'example-owner/example-web',
    origin: 'git@github.com:example-owner/example-web.git',
    files: ['README.md', 'package.json', 'src/index.ts'],
} as const;
