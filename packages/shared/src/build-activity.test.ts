import { it, expect } from 'vite-plus/test';
import { buildActivity, type Item } from './model.ts';

it('requires current build execution and rejects waiting, cached and stale evidence', () => {
  const item = { status: 'In progress', buildPhase: 'implement', threads: [{ purpose: 'build', state: 'running', currentRunning: true }] } as unknown as Item;
  expect(buildActivity(item)).toEqual({ label: 'Implementing', running: true });
  expect(buildActivity(item, true).running).toBe(false);
  expect(buildActivity({ ...item, threads: 'unavailable' })).toEqual({ label: 'Activity unavailable', running: false });
  for (const thread of [{ purpose: 'shape', currentRunning: true }, { purpose: 'build', state: 'running' }, { purpose: 'build', currentRunning: true, observedAt: 'cached' }]) {
    expect(buildActivity({ ...item, threads: [thread] } as Item).running).toBe(false);
  }
  expect(buildActivity({ ...item, status: 'Done' })).toEqual({ label: 'Done', running: false });
  expect(buildActivity({ ...item, threads: [], buildRequested: true })).toEqual({ label: 'Start requested', running: false });
});

it('shows pending relaunch after stopped or finished build threads', () => {
  for (const state of ['stopped', 'finished']) {
    expect(buildActivity({ status: 'In progress', buildRequested: true, threads: [{ purpose: 'build', state }] } as Item)).toEqual({ label: 'Start requested', running: false });
  }
});

for (const status of ['Verify', 'Ready to merge'] as const) {
  const running = { status, buildPhase: 'retro', threads: [{ id: 'build', purpose: 'build', state: 'running', currentRunning: true }] } as unknown as Item;

  it(`says Working at ${status} while the build thread or a child runs, whatever the phase`, () => {
    expect(buildActivity(running)).toEqual({ label: 'Working', running: true });
    expect(buildActivity({ ...running, threads: [{ purpose: 'build', state: 'done', hasRunningChildren: true }] } as Item)).toEqual({ label: 'Working', running: true });
  });

  it(`says ${status} when the thread is idle, asks a question, is held or can't be read`, () => {
    const recorded = { label: status, running: false };
    expect(buildActivity({ ...running, threads: [{ purpose: 'build', state: 'done' }] } as Item)).toEqual(recorded);
    expect(buildActivity({ ...running, threads: [{ purpose: 'build', state: 'needs you' }] } as Item)).toEqual(recorded);
    expect(buildActivity({ ...running, threads: [{ purpose: 'build', state: 'needs you', hasRunningChildren: true }] } as Item)).toEqual(recorded);
    expect(buildActivity({ ...running, needsYou: { reason: 'Stuck', offers: [] } } as unknown as Item)).toEqual(recorded);
    expect(buildActivity(running, true)).toEqual(recorded);
  });
}
