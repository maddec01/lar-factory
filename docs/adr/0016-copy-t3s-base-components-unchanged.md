# Copy T3's base components unchanged

Settled in issue #267.

The design system copies the base components the board uses from T3 Code's `apps/web/src/components/ui` and from coss byte for byte, and records each file's upstream path and commit in a copy record. The build adapts to the copies instead: `~` and `@/registry/default` aliases, a separate Bundler-resolution tsconfig for the copied files, and the board's own `cn` and `env` modules. An update from upstream is then a fresh copy and a diff. This sits beside ADR 0011, which stays.

`apps/web` type-checks the copies it imports in its own program, so it uses Bundler resolution too, with `~` mapped to `packages/ui/src` in its tsconfig and its Vite config. Its other compiler options stay as they were, and the copies pass them. The board's own files keep their `.ts` import extensions; `~` is for the copies only.

## Considered options

Rewriting each copy's `~` and extensionless imports into the board's style was rejected. It needs no alias or second tsconfig, but every update from upstream would need the same edits again.

Keeping `apps/web` on `nodenext` was rejected. Node's resolution needs an extension on every relative import, and the copies have none, so `apps/web` could only type-check them through declaration files built from `packages/ui`, a build step a source-only package doesn't have.
