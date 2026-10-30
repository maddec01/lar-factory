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
