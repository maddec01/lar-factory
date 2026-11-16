import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

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
        boundaries: ['Offline downloads'],
        check: {
            title: 'Pause on iPhone, resume on Apple TV',
            steps: [
                'Play a title on iPhone, pause at 12:34',
                'Open the same title on Apple TV',
                'Playback starts within a second of 12:34',
            ],
        },
    });
});
test('Map prose and stale diagrams cannot create Dependencies or graph facts', () => {
    const body =
        '## Map\n```mermaid\nflowchart\n- not a Dependency\nb1[Resume] --> dep1{{Relay API}}\n```\n- A resume endpoint, from team/relay, blocks Resume\n* No external Dependencies are recorded.\n* #12 depends on #13; #12 is to shape.\n\n## Fog\n- Two\n';

    assert.deepEqual(parseConceptMap(body), {
        destination: '',
        decisions: [],
        fog: ['Two'],
    });
});
