// The ownership engine runs off the main thread so copying and hashing cannot stall the board.
import { parentPort, workerData } from "node:worker_threads";
import { InstallError, installSkills, type InstallOptions } from "@lar-factory/shared/install-skills";

export interface InstallWork {
  home: string;
  bundle: string;
  version: string;
  options: Omit<InstallOptions, "onProgress" | "now">;
}

const work = workerData as InstallWork;
try {
  const result = installSkills(work.home, work.bundle, work.version, {
    ...work.options, onProgress: (progress) => parentPort!.postMessage({ progress }),
  });
  parentPort!.postMessage({ result });
} catch (cause) {
  parentPort!.postMessage({ error: { message: cause instanceof Error ? cause.message : String(cause),
    changed: cause instanceof InstallError ? cause.changed : true } });
}
