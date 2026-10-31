#!/usr/bin/env node
// Test-only T3 Code CLI. Never starts a real thread or adds a real project.
const fs = require('node:fs');
const args = process.argv.slice(2);
// The tool check's version probe, which tests don't count as a call.
if (args[0] === '--version') {
  process.stdout.write('t3 v0.1.4-nightly.1\n');
  process.exit(0);
}
const options = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8')).t3 ?? {};
fs.appendFileSync(process.env.FAKE_GH_STATE + '.t3calls', JSON.stringify(args) + '\n');
const main = async () => {
  if (options.delay) await new Promise((r) => setTimeout(r, options.delay));
  // Adding a project: T3 lists the folder as project `added`, or refuses with `addFails` as its message.
  if (args[0] === 'project' && args[1] === 'add') {
    if (options.addFails) {
      process.stderr.write(options.addFails);
      process.exitCode = 1;
      return;
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.env.T3_STATE_DB);
    db.prepare('INSERT INTO projection_projects VALUES (?, ?, ?, NULL)').run('added', 'added', args[2]);
    db.close();
    return;
  }
  if (args[1] === 'list' && options.recover) {
    process.stdout.write(JSON.stringify([{ threadId: 'thread-1', title: '#12 Issue 12' }]));
    return;
  }
  if (args[1] === 'show' && options.recover) {
    if (options.recover === 'deleted') {
      process.stderr.write('Thread thread-1 is no longer available.');
      process.exitCode = 1;
    } else {
      // The thread's first message is the one the board sent with its start, or `firstMessage` for one an earlier board sent.
      const started = fs.readFileSync(process.env.FAKE_GH_STATE + '.t3calls', 'utf8').trim().split('\n').map((line) => JSON.parse(line))
        .find((call) => call[1] === 'start');
      process.stdout.write(JSON.stringify({ thread: { threadId: 'thread-1' }, messages: [{ role: 'user', text: options.firstMessage ?? started?.[3] ?? '' }] }));
    }
    return;
  }
  if (options.fail === 'down') {
    process.stderr.write('Could not reach the T3 Code server. Is T3 Code running?');
    process.exitCode = 1;
  } else if (options.fail === 'killed') process.kill(process.pid, 'SIGKILL');
  else if (options.fail === 'garbage') process.stdout.write('not json');
  // Like T3, title the thread from the first line of its first message.
  else {
    // Each start opens a new thread, numbered from thread-1.
    const starts = fs.readFileSync(process.env.FAKE_GH_STATE + '.t3calls', 'utf8').trim().split('\n').filter((line) => JSON.parse(line)[1] === 'start').length;
    process.stdout.write(JSON.stringify({ threadId: `thread-${starts}`, runId: 'run-1', title: options.untitled ? undefined : args[3].split('\n')[0] }));
  }
};
main();
