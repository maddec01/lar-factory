// Markdown export: copies a work record's brief, decision or map, and a concept's decisions, into a folder for reading
// outside the board. The files are copies, never an authority the board reads back, and hold only the record's markdown.

import { closeSync, constants, copyFileSync, linkSync, lstatSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { WorkRecordError } from './database.ts';
import { BODIES, type WorkRecords } from './work-records.ts';

/** The errors a filesystem without hard links, such as exFAT or some network shares, gives for `linkSync`. */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']);

/** A file name part from the body's first heading: lowercase letters and digits joined by hyphens, never a path. */
function slug(markdown: string): string {
  const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(markdown)?.[1] ?? '';
  return heading.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '');
}

/**
 * Writes the record's own body and, for a concept, each of its decisions' text to the existing folder `destination`,
 * named `<body>-<title>.md` from each body's first heading. Returns the paths it wrote. It never replaces a file the
 * folder already holds, and a failure leaves no file behind.
 */
export function exportMarkdown(records: WorkRecords, workId: string, destination: string): string[] {
  const record = records.read(workId);
  const bodies = BODIES.map((body) => ({ body, workId, markdown: records.body(workId, body) }));
  if (record.kind === 'concept') {
    for (const child of records.children(workId)) {
      if (child.kind === 'decision') bodies.push({ body: 'decision', workId: child.workId, markdown: records.body(child.workId, 'decision') });
    }
  }
  const files = bodies.filter((entry): entry is typeof entry & { markdown: string } => entry.markdown !== null);
  if (!files.length) throw new WorkRecordError('not-found', `The work record ${workId} has nothing to export: no brief, decision or map.`);
  if (typeof destination !== 'string' || !isAbsolute(destination)) throw new WorkRecordError('invalid', `The export folder "${String(destination)}" isn't an absolute path.`);
  if (!statSync(destination, { throwIfNoEntry: false })?.isDirectory()) throw new WorkRecordError('invalid', `The export folder ${destination} isn't a folder.`);

  const names = new Set<string>();
  const planned = files.map(({ body, workId: owner, markdown }) => {
    let name = `${body}-${slug(markdown) || owner}.md`;
    if (names.has(name)) name = `${name.slice(0, -3)}-${owner}.md`;
    names.add(name);
    return { path: join(destination, name), temporary: join(destination, `.${name}.${process.pid}.tmp`), markdown };
  });
  const failed = (reason: string) => new WorkRecordError('export-failed', `Can't export the work record ${workId} to ${destination}: ${reason}.`);
  const taken = planned.find((file) => lstatSync(file.path, { throwIfNoEntry: false }));
  if (taken) throw failed(`${taken.path} already exists`);
  // A hard link fails when its name exists, so a file made after the check above is never replaced either. Where the
  // filesystem has no hard links, an exclusive copy fails the same way.
  const written: string[] = [];
  const linked: string[] = [];
  try {
    for (const file of planned) {
      const fd = openSync(file.temporary, 'wx');
      written.push(file.temporary);
      try {
        writeFileSync(fd, file.markdown);
      } finally {
        closeSync(fd);
      }
    }
    for (const file of planned) {
      try {
        linkSync(file.temporary, file.path);
      } catch (error) {
        if (!NO_HARD_LINKS.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
        copyFileSync(file.temporary, file.path, constants.COPYFILE_EXCL);
      }
      linked.push(file.path);
    }
  } catch (error) {
    for (const path of linked) rmSync(path, { force: true });
    throw failed((error as Error).message);
  } finally {
    for (const path of written) rmSync(path, { force: true });
  }
  return planned.map((file) => file.path);
}
