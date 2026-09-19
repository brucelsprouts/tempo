import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWriter } from './writer';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Writes that record their names, and can be held open until released. */
function recorder() {
  const done: string[] = [];
  const held = new Map<string, () => void>();
  const write = (name: string, hold = false) => () =>
    new Promise<void>((resolve) => {
      const finish = () => {
        done.push(name);
        resolve();
      };
      if (hold) held.set(name, finish);
      else finish();
    });
  return { done, held, write };
}

describe('a writer', () => {
  it('waits for a pause, then runs only the latest write', async () => {
    const w = createWriter(400);
    const r = recorder();
    w.schedule(r.write('a'));
    await vi.advanceTimersByTimeAsync(200);
    w.schedule(r.write('b'));
    await vi.advanceTimersByTimeAsync(399);
    expect(r.done).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.done).toEqual(['b']);
  });

  it('runs what is waiting at once when flushed', async () => {
    const w = createWriter(400);
    const r = recorder();
    w.schedule(r.write('a'));
    expect(w.queued).toBe(true);
    await w.flush();
    expect(r.done).toEqual(['a']);
    expect(w.queued).toBe(false);
  });

  it('never starts a write while another is in flight', async () => {
    const w = createWriter(400);
    const r = recorder();
    w.schedule(r.write('slow', true));
    await vi.advanceTimersByTimeAsync(400);
    w.schedule(r.write('next'));
    const flushed = w.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.done).toEqual([]);
    r.held.get('slow')!();
    await flushed;
    expect(r.done).toEqual(['slow', 'next']);
  });

  it('waits for a write in flight when flushed with nothing waiting', async () => {
    const w = createWriter(400);
    const r = recorder();
    w.schedule(r.write('slow', true));
    await vi.advanceTimersByTimeAsync(400);
    let settled = false;
    const flushed = w.flush().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    r.held.get('slow')!();
    await flushed;
    expect(settled).toBe(true);
  });

  it('carries on after a write that throws', async () => {
    const w = createWriter(400);
    const r = recorder();
    w.schedule(() => Promise.reject(new Error('boom')));
    await w.flush();
    w.schedule(r.write('after'));
    await w.flush();
    expect(r.done).toEqual(['after']);
  });
});
