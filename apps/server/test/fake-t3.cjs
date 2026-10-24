#!/usr/bin/env node
// Test-only T3 Code CLI. Never starts a real thread.
const fs = require('node:fs');
const args = process.argv.slice(2);
const options = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8')).t3 ?? {};
fs.appendFileSync(process.env.FAKE_GH_STATE + '.t3calls', JSON.stringify(args) + '\n');
const main = async () => {
  if (options.delay) await new Promise((r) => setTimeout(r, options.delay));
  if (options.fail === 'down') {
    process.stderr.write('Could not reach the T3 Code server. Is T3 Code running?');
    process.exitCode = 1;
  } else if (options.fail === 'killed') process.kill(process.pid, 'SIGKILL');
  else if (options.fail === 'garbage') process.stdout.write('not json');
  // Like T3, title the thread from the first line of its first message.
  else process.stdout.write(JSON.stringify({ threadId: 'thread-1', runId: 'run-1', title: options.untitled ? undefined : args[3].split('\n')[0] }));
};
main();
