// Holds a provider CLI back once its provider says it is rate limited, so the board stops spending calls that would
// fail anyway. gh and az each keep one: every call through github.ts or azure-items.ts checks it before it runs.

/** The texts gh and az print for a primary or secondary rate limit, or Azure DevOps throttling. */
const RATE_LIMITED = /rate limit|HTTP 429|too many requests|abuse detection|TF400733/i;
const FIRST_WAIT_MS = 60_000;
const LONGEST_WAIT_MS = 15 * 60_000;

export interface Cooldown {
  /** Throws while the tool cools down, naming when calls resume. */
  check(now?: number): void;
  /** Takes in a failed call's error text; a rate limit starts a cooldown until `reset` finds the reset, else a backoff. */
  failed(detail: string, now?: number): Promise<void>;
  /** A call went through, so the next rate limit backs off from the start again. */
  succeeded(): void;
  /** When calls resume, in ms since the epoch; 0 while the tool isn't cooling down. */
  until(now?: number): number;
}

/** `reset` looks up when the exhausted limit resets, in ms since the epoch, or null when it can't tell. */
export function createCooldown(tool: string, reset: () => Promise<number | null> = async () => null): Cooldown {
  let until = 0;
  let wait = FIRST_WAIT_MS;
  return {
    check(now = Date.now()) {
      if (now < until) throw new Error(`${tool} is rate limited; the board makes no ${tool} calls until ${new Date(until).toLocaleTimeString()}.`);
    },
    async failed(detail, now = Date.now()) {
      if (!RATE_LIMITED.test(detail)) return;
      const at = await reset().catch(() => null);
      until = at !== null && at > now ? at : now + wait;
      wait = Math.min(wait * 2, LONGEST_WAIT_MS);
    },
    succeeded() {
      wait = FIRST_WAIT_MS;
    },
    until: (now = Date.now()) => (now < until ? until : 0),
  };
}
