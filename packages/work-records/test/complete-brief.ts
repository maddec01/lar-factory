/** Complete handover input for tests whose subject is approval/graph mechanics rather than brief sections. */
const HANDOVER = `

## Acceptance
The specified fixture behaviour is delivered.
## Affected areas
The fixture's declared delivery area.
## Tests
\`test/delivery.test.ts\`: preserves the specified delivery behaviour and boundary.
## Cause
The fixture reproduces an incorrect delivery result.
## Evidence
The fixture's observed result differs from its expected result.
## Regression test
\`test/delivery.test.ts\`: reproduces the incorrect result.
## Red-before-green
Observe the regression fail before the fix and pass afterward.
`;

export const completeBrief = (text: string): string => (text.includes(HANDOVER) ? text : text + HANDOVER);
