// A concept's map, read from the sections of its issue body that lar-shape's concepts.md lays out.

import type { ConceptMap, EndToEndCheck } from './model.ts';

/** The lines under each `## ` heading, by lowercased heading; the first heading of a name wins, so an Original issue's copy can't override the map's. */
function sections(body: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let lines: string[] | null = null;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const name = heading[1]!.toLowerCase();
      lines = found.has(name) ? null : [];
      if (lines) found.set(name, lines);
    } else lines?.push(line);
  }
  return found;
}

const matches = (lines: string[], pattern: RegExp) => lines.flatMap((line) => pattern.exec(line)?.[1]?.trim() || []);

/** A bullet that only says there is nothing, such as "none", "None." or "_none_". */
const NONE = /^[\W_]*none[\W_]*$/i;

/** A section's bullets, leaving out a placeholder "none". */
const bullets = (lines: string[] = []) => matches(lines, /^[-*]\s+(.+)$/).filter((b) => !NONE.test(b));

const STEP = /^\d+[.)]\s+(.+)$/;

function paragraph(lines: string[] = []): string {
  const start = lines.findIndex((l) => l.trim());
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && !l.trim());
  return lines.slice(start, end < 0 ? undefined : end).map((l) => l.trim()).join(' ');
}

/** The title is the section's first line, unless that is already a step. */
function endToEndCheck(lines: string[]): EndToEndCheck {
  const trimmed = lines.map((l) => l.trim());
  const first = trimmed.find((l) => l) ?? '';
  return { title: STEP.test(first) ? '' : first, steps: matches(trimmed, STEP) };
}

/** Parses a concept's issue body; a missing section is empty, and a body without an End-to-end check has no check. */
export function parseConceptMap(body: string): ConceptMap {
  const found = sections(body);
  const map: ConceptMap = {
    destination: paragraph(found.get('destination')),
    decisions: bullets(found.get('decisions so far')),
    fog: bullets(found.get('fog')),
  };
  const check = found.get('end-to-end check');
  if (check) map.check = endToEndCheck(check);
  return map;
}
