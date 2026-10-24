// PROTOTYPE, throwaway. What every line variant gets, and a mock of what a concept would carry beyond GitHub's
// fields (issue #167): its destination, decisions, the tasks that shape it, what waits on what, and its T3 threads.

import type { BoardData, Item } from '@mux-factory/shared';
import type { Pick } from '../list-sidebar.tsx';

export interface LineProps {
  /** The items to show, already narrowed to the repo picked in the sidebar (or the whole factory). */
  items: Item[];
  /** The whole board, to find a concept's children and parents across repos. */
  data: BoardData;
  now: number;
  pick: Pick;
}

/** A T3 Code thread working on an item. The board starts threads only when they can run, so none sit waiting to be told to continue. */
interface MockThread {
  title: string;
  state: 'running' | 'needs you' | 'done' | 'not started';
  /** The issue the thread works on. */
  issue: number;
  updated: string;
}

/** One step that shapes or builds the concept. Decisions come from the wayfinder skill: grill, prototype, research. */
interface MockTask {
  issue: number;
  kind: 'grill' | 'prototype' | 'research' | 'build' | 'end-to-end';
  /** Issue numbers this task waits on. */
  waitsOn: number[];
  repo: string;
}

interface MockConcept {
  /** Where the concept ends: the destination paragraph. */
  destination: string;
  decisions: string[];
  /** Questions still open, each answered by a task. */
  open: string[];
  tasks: MockTask[];
  threads: MockThread[];
  /** The end-to-end check the agents run once every build lands. */
  endToEnd: { title: string; state: 'waiting' | 'running' | 'passed' | 'failed'; steps: string[] };
}

/** Keyed by issue number: #200 is a concept still being shaped; #180 is coupled work across two repos, built. */
export const CONCEPTS: Record<number, MockConcept> = {
  200: {
    destination: 'Anyone with a Mux server signs in on mux.app with an owner account and streams their library away from home through a relay, with no port forwarding. The server registers with the cloud once; clients find it by account.',
    decisions: [
      'Owner accounts live in the cloud, not on each server (#203 research).',
      'Hosting the relay costs about $40 a month for the first 500 owners (#203).',
      'Sign-in uses passkeys first, email links as fallback.',
    ],
    open: ['Does the relay only broker connections, or carry the stream too (full TURN)? (#201)', 'What does the sign-in screen look like on the website and in the apps? (#202)'],
    tasks: [
      { issue: 203, kind: 'research', waitsOn: [], repo: 'maddec01/mux-server' },
      { issue: 201, kind: 'grill', waitsOn: [203], repo: 'maddec01/mux-server' },
      { issue: 202, kind: 'prototype', waitsOn: [], repo: 'maddec01/mux-server' },
      { issue: 140, kind: 'build', waitsOn: [202], repo: 'maddec01/mux-server' },
      { issue: 150, kind: 'build', waitsOn: [201], repo: 'maddec01/mux-server' },
    ],
    threads: [
      { title: 'Research: hosting cost of the relay', state: 'done', issue: 203, updated: '2026-10-19T10:00:00Z' },
      { title: 'Grill: relay broker only or full TURN', state: 'running', issue: 201, updated: '2026-10-24T08:40:00Z' },
      { title: 'Prototype: sign-in screen', state: 'needs you', issue: 202, updated: '2026-10-21T16:20:00Z' },
      { title: 'Build: owner accounts', state: 'not started', issue: 140, updated: '2026-10-21T09:00:00Z' },
    ],
    endToEnd: { title: 'Sign in on the website, then stream from a phone off Wi-Fi', state: 'waiting', steps: ['Create an owner account on mux.app', 'Register a server with the account', 'Open the app on cellular and play a 4K title'] },
  },
  180: {
    destination: 'Stop watching on one device and resume on another at the same second. The server stores each position per device and profile; the Apple apps read it on open.',
    decisions: ['Positions are stored per profile, not per device (#181).', 'Apps poll on foreground; no push for now.'],
    open: [],
    tasks: [
      { issue: 181, kind: 'build', waitsOn: [], repo: 'maddec01/mux-server' },
      { issue: 40, kind: 'build', waitsOn: [181], repo: 'maddec01/mux-apple' },
    ],
    threads: [
      { title: 'Build: store the playback position per device', state: 'done', issue: 181, updated: '2026-10-18T11:00:00Z' },
      { title: 'Build: resume from the stored position', state: 'done', issue: 40, updated: '2026-10-20T14:00:00Z' },
      { title: 'End-to-end: resume across devices', state: 'running', issue: 180, updated: '2026-10-24T07:55:00Z' },
    ],
    endToEnd: { title: 'Pause on iPhone, resume on Apple TV', state: 'running', steps: ['Play a title on iPhone, pause at 12:34', 'Open the same title on Apple TV', 'Playback starts within a second of 12:34'] },
  },
};
