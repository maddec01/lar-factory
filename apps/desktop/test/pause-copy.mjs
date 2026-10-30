// A controlled filesystem delay in the real worker, after it reports the skill it is about to copy.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

const copy = fs.cpSync;
let paused = false;
fs.cpSync = (...args) => {
  if (!paused) {
    paused = true;
    parentPort.postMessage({ paused: true });
    Atomics.wait(new Int32Array(workerData.gate), 0, 0);
  }
  return copy(...args);
};
syncBuiltinESMExports();
