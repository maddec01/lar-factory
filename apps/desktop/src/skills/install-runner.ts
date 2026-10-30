// Only plans and ownership-engine results cross this worker channel. The page receives the sanitized board snapshot.
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { InstallError, type InstallResult, type TargetProgress } from "@lar-factory/shared/install-skills";
import type { InstallWork } from "./install-worker.ts";

const startWorker = (work: InstallWork) => new Worker(join(import.meta.dirname,
  import.meta.url.endsWith(".ts") ? "install-worker.ts" : "install-worker.cjs"), { workerData: work });

export const runInstall = (work: InstallWork, progress: (event: TargetProgress) => void, worker = startWorker(work)): Promise<InstallResult> =>
  new Promise((resolve, reject) => {
    let answered = false;
    worker.on("message", (message: { progress?: TargetProgress; result?: InstallResult; error?: { message: string; changed: boolean } }) => {
      if (message.progress) progress(message.progress);
      else if (message.result) { answered = true; resolve(message.result); }
      else if (message.error) { answered = true; reject(new InstallError(message.error.message, message.error.changed)); }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (!answered) reject(new InstallError(`Skill installer stopped before answering (exit ${code}). Retry the install.`, true));
    });
  });
