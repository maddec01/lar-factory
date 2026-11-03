import { expect, test } from 'vite-plus/test';
import { createLoopTrace, type LoopTraceOptions } from './loop-trace.ts';

/** A trace on a clock the test moves, with its lines. `pass` spends CPU alongside the time, unless told otherwise. */
function traced() {
  let at = 0;
  let cpuAt = 0;
  let reportGc = (_startedAt: number, _ms: number) => {};
  const lines: string[] = [];
  const delay = { enable() {}, disable() {}, reset() {}, max: 480e6, percentile: () => 12e6 } as unknown as LoopTraceOptions['delay'];
  const trace = createLoopTrace({ now: () => at, cpu: () => cpuAt, delay, watchGc: (report) => { reportGc = report; return () => {}; } });
  trace.begin((line) => lines.push(line), 0);
  lines.length = 0;
  return { trace, lines, pass: (ms: number, cpuMs = ms) => { at += ms; cpuAt += cpuMs; }, gc: (startedAt: number, ms: number) => reportGc(startedAt, ms), teardown: () => trace.end() };
}

test('a stall names the work that ran in it, and how much of it no label covers', () => {
  const { trace, lines, pass, teardown } = traced();
  trace.span('records', () => pass(300));
  trace.span('threads', () => pass(150));
  pass(40);
  trace.tick();
  trace.tick();
  expect(lines).toEqual(['loop stall 480 ms from 0 ms: records 300 ms, threads 150 ms, unlabelled 30 ms; cpu 490 ms, gc 0 ms; label cpu: records 300 ms, threads 150 ms, unlabelled 40 ms']);
  teardown();
});

test('a gap under the threshold logs nothing, and a later stall names only its own work', () => {
  const { trace, lines, pass, teardown } = traced();
  trace.span('records', () => pass(30));
  trace.tick();
  expect(lines).toEqual([]);
  trace.span('threads', () => pass(70));
  trace.tick();
  trace.tick();
  expect(lines).toEqual(['loop stall 60 ms from 30 ms: threads 70 ms; cpu 70 ms, gc 0 ms; label cpu: threads 70 ms']);
  teardown();
});

test('a span counts its own time, leaving out a span nested in it', () => {
  const { trace, lines, pass, teardown } = traced();
  trace.span('local refresh', () => {
    pass(20);
    trace.span('records', () => pass(100));
  });
  trace.tick();
  trace.tick();
  expect(lines).toEqual(['loop stall 110 ms from 0 ms: records 100 ms, local refresh 20 ms; cpu 120 ms, gc 0 ms; label cpu: records 100 ms, local refresh 20 ms']);
  teardown();
});

test('a timed block leaves out the spans that ran inside it', () => {
  const { trace, lines, pass, teardown } = traced();
  const spannedAt = trace.spanned();
  pass(40);
  trace.span('board push', () => pass(60));
  trace.block('stats publish', 100, spannedAt, 100);
  trace.tick();
  trace.tick();
  expect(lines).toEqual(['loop stall 90 ms from 0 ms: board push 60 ms, stats publish 40 ms; cpu 100 ms, gc 0 ms; label cpu: board push 60 ms, stats publish 40 ms']);
  teardown();
});

test('a window gives the whole loop delay and each label\'s synchronous total, count and longest', () => {
  const { trace, lines, pass, teardown } = traced();
  trace.span('records', () => pass(40));
  trace.span('records', () => pass(10));
  trace.endWindow();
  expect(lines).toEqual(['loop window 0 to 50 ms: loop delay max 480 ms, p99 12 ms; GC 0 ms, longest 0 ms; sync: records 50 ms over 2, longest 40 ms; process cpu 50 ms; sync cpu: records 50 ms']);
  teardown();
});

test('wall far above CPU shows the thread was held, not working', () => {
  const { trace, lines, pass, teardown } = traced();
  trace.span('local refresh', () => pass(200, 5));
  pass(100, 1);
  trace.tick();
  trace.tick();
  expect(lines).toEqual(['loop stall 290 ms from 0 ms: local refresh 200 ms, unlabelled 90 ms; cpu 6 ms, gc 0 ms; label cpu: local refresh 5 ms, unlabelled 1 ms']);
  teardown();
});

test('a stall counts the GC inside it, as the observer reports it after the stall ends', () => {
  const { trace, lines, pass, gc, teardown } = traced();
  gc(-50, 20);
  pass(100);
  trace.tick();
  gc(30, 12);
  gc(95, 40);
  expect(lines, 'the line waits a tick for the observer').toEqual([]);
  pass(5);
  trace.tick();
  expect(lines).toEqual(['loop stall 90 ms from 0 ms: unlabelled 90 ms; cpu 100 ms, gc 17 ms; label cpu: unlabelled 100 ms']);
  teardown();
});

test('ending the trace writes a stall still waiting for its GC', () => {
  const { trace, lines, pass, teardown } = traced();
  pass(100);
  trace.tick();
  teardown();
  expect(lines[0]).toMatch(/^loop stall 90 ms from 0 ms: unlabelled 90 ms; cpu 100 ms, gc 0 ms/);
  expect(lines.at(-1)).toMatch(/^loop trace ended: .*; process cpu 100 ms; sync cpu: none$/);
});

test('a slow request names its wait for the tool check, and a fast one logs nothing', () => {
  const { trace, lines, teardown } = traced();
  trace.request('GET /api/board', 12, 0);
  trace.request('GET /api/board', 1095, 1094);
  expect(lines).toEqual(['request GET /api/board took 1095 ms, 1094 ms of it waiting for the first tool check']);
  teardown();
});

test('after the trace ends, spans only run their work', () => {
  const { trace, lines, pass, teardown } = traced();
  teardown();
  lines.length = 0;
  expect(trace.span('records', () => { pass(500); return 7; })).toBe(7);
  trace.request('GET /api/board', 900, 0);
  expect(lines).toEqual([]);
});
