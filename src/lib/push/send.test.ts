import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushSubscriptionRow } from '@/lib/db/database.types';

/**
 * What a send does to the subscription list. A rejected device has to leave
 * eventually, and a push service having a bad minute must never cost one.
 */

/** Endpoint → what the push service answers. Absent means delivered. */
const answers = new Map<string, { statusCode?: number; body?: string; message?: string }>();

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }) => {
      const answer = answers.get(sub.endpoint);
      if (answer) throw Object.assign(new Error(answer.message ?? 'unexpected'), answer);
    },
  },
}));

const { MAX_FAILURES, sendToAll } = await import('./send');

interface Write {
  op: 'update' | 'delete';
  payload?: unknown;
  column: string;
  value: unknown;
}

let writes: Write[] = [];

function fakeClient() {
  return {
    from: () => ({
      update: (payload: unknown) => ({
        in: async (column: string, value: unknown) => {
          writes.push({ op: 'update', payload, column, value });
          return { error: null };
        },
        eq: async (column: string, value: unknown) => {
          writes.push({ op: 'update', payload, column, value });
          return { error: null };
        },
      }),
      delete: () => ({
        in: async (column: string, value: unknown) => {
          writes.push({ op: 'delete', column, value });
          return { error: null };
        },
      }),
    }),
  } as never;
}

function sub(id: string, failure_count = 0): PushSubscriptionRow {
  return {
    id,
    owner_id: 'o',
    endpoint: `https://push.example/${id}/secret-token`,
    p256dh: 'p',
    auth: 'a',
    user_agent: null,
    created_at: '',
    last_seen_at: '',
    failure_count,
  };
}

const payload = { title: 't', body: 'b', url: '/', tag: 'x' };
let logged: unknown[][] = [];

beforeEach(() => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  answers.clear();
  writes = [];
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    logged.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendToAll', () => {
  it('counts a rejection against the device', async () => {
    const s = sub('a', 1);
    answers.set(s.endpoint, { statusCode: 400 });
    const result = await sendToAll(fakeClient(), [s], payload);
    expect(result).toEqual({ sent: 0, pruned: 0, failed: 1 });
    expect(writes).toEqual([
      { op: 'update', payload: { failure_count: 2 }, column: 'id', value: 'a' },
    ]);
  });

  it('removes a device on the rejection that reaches the limit', async () => {
    const s = sub('a', MAX_FAILURES - 1);
    answers.set(s.endpoint, { statusCode: 401 });
    const result = await sendToAll(fakeClient(), [s], payload);
    expect(result.pruned).toBe(1);
    expect(writes).toEqual([
      { op: 'delete', column: 'endpoint', value: [s.endpoint] },
    ]);
  });

  it('removes a device the service says is gone, at once', async () => {
    const s = sub('a');
    answers.set(s.endpoint, { statusCode: 410 });
    const result = await sendToAll(fakeClient(), [s], payload);
    expect(result.pruned).toBe(1);
    expect(writes[0].op).toBe('delete');
  });

  it.each([429, 500, 503, 413, undefined])(
    'does not hold a %s against the device',
    async (statusCode) => {
      const s = sub('a', MAX_FAILURES - 1);
      answers.set(s.endpoint, { statusCode });
      const result = await sendToAll(fakeClient(), [s], payload);
      expect(result).toEqual({ sent: 0, pruned: 0, failed: 1 });
      expect(writes).toEqual([]);
    },
  );

  it('clears the count when a send gets through', async () => {
    const s = sub('a', 3);
    const result = await sendToAll(fakeClient(), [s], payload);
    expect(result.sent).toBe(1);
    expect(writes).toEqual([
      { op: 'update', payload: { failure_count: 0 }, column: 'id', value: 'a' },
    ]);
  });

  it('writes nothing for a healthy device', async () => {
    await sendToAll(fakeClient(), [sub('a')], payload);
    expect(writes).toEqual([]);
  });

  it('one rejected device does not stop the others', async () => {
    const bad = sub('bad');
    answers.set(bad.endpoint, { statusCode: 400 });
    const result = await sendToAll(fakeClient(), [bad, sub('good')], payload);
    expect(result).toEqual({ sent: 1, pruned: 0, failed: 1 });
  });

  it('logs which device and why, without the endpoint token', async () => {
    const s = sub('device-7');
    answers.set(s.endpoint, { statusCode: 400, body: '{"reason":"BadDeviceToken"}' });
    await sendToAll(fakeClient(), [s], payload);
    const line = logged.flat().join(' ');
    expect(line).toContain('device-7');
    expect(line).toContain('push.example');
    expect(line).toContain('BadDeviceToken');
    expect(line).not.toContain('secret-token');
  });
});
