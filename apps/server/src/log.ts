/** Logs a line with the time it happened. */
export function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}
