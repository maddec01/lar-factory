// Node-only transport shared by publication settings and writes. Uses the local CLI login; never retries.
import { execFile } from 'node:child_process';

export function providerCommand(command: 'gh' | 'az', args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.env[command === 'gh' ? 'GH_PATH' : 'AZ_PATH'] || command, args,
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          // Do not include execFile's command line: it may contain private content.
          const failure = new Error(`${command} failed: ${stderr.trim() || error.code || 'lost response'}`);
          reject(failure);
        } else resolve(stdout);
      });
    child.stdin?.on('error', () => { /* execFile's completion owns a lost pipe. */ });
    child.stdin?.end(input);
  });
}
