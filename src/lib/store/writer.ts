/**
 * Writes that follow typing without chasing it.
 *
 * The entry popup saves as it changes, which would be a write per keystroke
 * with nothing in between. This waits for a pause, keeps only the latest write
 * — an earlier draft is superseded rather than sent — and never starts one
 * while another is in flight, so a slow response cannot land an older draft
 * over a newer one.
 */
export interface Writer {
  /** Run `write` once `delay` has passed with nothing newer, replacing any not yet started. */
  schedule(write: () => Promise<void>): void;
  /** Run whatever is waiting now, after anything already running; resolves when all of it has. */
  flush(): Promise<void>;
  /** Whether a write is waiting to start. */
  readonly queued: boolean;
}

export function createWriter(delay: number): Writer {
  let waiting: (() => Promise<void>) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    for (;;) {
      if (running) {
        await running;
        continue;
      }
      if (!waiting) return;
      const write = waiting;
      waiting = null;
      // A write reports its own failure. One that throws anyway must not
      // wedge every write behind it.
      running = write()
        .catch(() => {})
        .finally(() => {
          running = null;
        });
    }
  }

  return {
    schedule(write) {
      waiting = write;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, delay);
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      return drain();
    },
    get queued() {
      return waiting !== null;
    },
  };
}
