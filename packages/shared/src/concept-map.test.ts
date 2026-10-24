import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { parseConceptMap } from './concept-map.ts';

const BODY = `## Destination
Stop watching on one device and resume on another
at the same second.

## Decisions so far
- Positions are stored per profile (#181).
- Apps poll on foreground.

## Fog
- Does the relay carry the stream too?

## Out of scope
- Offline downloads

## End-to-end check
Pause on iPhone, resume on Apple TV
1. Play a title on iPhone, pause at 12:34
2. Open the same title on Apple TV
3. Playback starts within a second of 12:34

<details><summary>Original issue</summary>

## Destination
An older destination
</details>
`;

test('a map body parses into its destination, decisions, fog and end-to-end check', () => {
  assert.deepEqual(parseConceptMap(BODY), {
    destination: 'Stop watching on one device and resume on another at the same second.',
    decisions: ['Positions are stored per profile (#181).', 'Apps poll on foreground.'],
    fog: ['Does the relay carry the stream too?'],
    check: {
      title: 'Pause on iPhone, resume on Apple TV',
      steps: ['Play a title on iPhone, pause at 12:34', 'Open the same title on Apple TV', 'Playback starts within a second of 12:34'],
    },
  });
});

test('sections between and after the ones the board reads are skipped', () => {
  const map = parseConceptMap('## Destination\nThere.\n\n## Notes\n- not a decision\n\n## Decisions so far\n- One\n\n## Map\n```mermaid\nflowchart\n- not fog\n```\n\n## Fog\n- Two\n');
  assert.deepEqual(map, { destination: 'There.', decisions: ['One'], fog: ['Two'] });
});

test('a missing section parses to empty, and a map with no end-to-end check has none', () => {
  assert.deepEqual(parseConceptMap('## Fog\n- Open\n'), { destination: '', decisions: [], fog: ['Open'] });
  assert.deepEqual(parseConceptMap(''), { destination: '', decisions: [], fog: [] });
});

test('headings match whatever their case, and lists take - or * bullets', () => {
  const map = parseConceptMap('## decisions SO FAR\r\n* One\r\n- Two\r\n## end-to-end check\r\nTitle\r\n1) Step');
  assert.deepEqual(map.decisions, ['One', 'Two']);
  assert.deepEqual(map.check, { title: 'Title', steps: ['Step'] });
});

test('an end-to-end check with steps but no title line has an empty title', () => {
  assert.deepEqual(parseConceptMap('## End-to-end check\n1. Only a step\n\n<details>\n').check, { title: '', steps: ['Only a step'] });
});
