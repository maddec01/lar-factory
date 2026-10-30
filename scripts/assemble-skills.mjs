import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
for (const name of ['lar-shape', 'lar-build']) {
  const output = new URL(`.assembled-skills/${name}/`, root);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(fileURLToPath(new URL(`skills/${name}/`, root)), fileURLToPath(output), { recursive: true });
  await cp(fileURLToPath(new URL('skills/shared/', root)), fileURLToPath(new URL('shared/', output)), { recursive: true });
}

// The bundle the app installs: only lar's own skills, so a skill dropped since the last run doesn't ship.
await rm(new URL('.assembled-skills/skills/', root), { recursive: true, force: true });
await mkdir(new URL('.assembled-skills/skills/', root), { recursive: true });
for (const name of ['lar-shape', 'lar-build']) {
  await cp(new URL(`.assembled-skills/${name}`, root), new URL(`.assembled-skills/skills/${name}`, root), { recursive: true });
}
for (const name of ['UPSTREAM.md', 'THIRD_PARTY_NOTICES.md']) await cp(new URL(name, root), new URL(`.assembled-skills/${name}`, root));
