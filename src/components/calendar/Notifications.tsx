'use client';

import { useCallback, useEffect, useState } from 'react';
import { currentState, disable, enable, isIOS, type PushState } from '@/lib/push/client';
import { Button, Section } from './ui';

/**
 * Turning reminders on, and the four honest answers about why you might not be
 * able to.
 *
 * More states than a toggle because iOS genuinely has them. A single Enable
 * button would throw in Safari, do nothing after a refusal, and give no way to
 * tell a browser that can't from a device that won't — so each case says what
 * it is and what to do about it instead.
 */
export function Notifications() {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void currentState().then(setState);
  }, []);

  const run = useCallback(async (action: () => Promise<PushState>) => {
    setBusy(true);
    setNote(null);
    try {
      setState(await action());
    } catch (error) {
      // Safari throws rather than resolving when the permission request isn't
      // inside a user gesture, or when the app isn't installed.
      setNote((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  async function sendTest() {
    setBusy(true);
    setNote(null);
    const response = await fetch('/api/push/test', { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    setNote(
      response.ok
        ? `Sent to ${body.sent} device${body.sent === 1 ? '' : 's'}.`
        : (body.error ?? 'Could not send.'),
    );
    setBusy(false);
  }

  return (
    <Section label="NOTIFICATIONS" meta={state === 'on' ? 'ON' : undefined}>
      {state === 'loading' && <p className="label">CHECKING…</p>}

      {state === 'needs-install' && (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-mute">
            iOS only delivers notifications to an app on the Home Screen. In a
            browser tab there is no way to ask for permission at all — this is
            Apple&apos;s rule, not a setting.
          </p>
          <ol className="space-y-1 text-[11px] leading-relaxed text-dim">
            <li>1 — Tap Share in the Safari toolbar</li>
            <li>2 — Add to Home Screen</li>
            <li>3 — Open Tempo from the icon, then come back here</li>
          </ol>
        </div>
      )}

      {state === 'unsupported' && (
        <p className="text-[11px] leading-relaxed text-mute">
          This browser has no Push API. {isIOS() ? 'iOS 16.4 or later is needed.' : ''}
        </p>
      )}

      {state === 'denied' && (
        <p className="text-[11px] leading-relaxed text-mute">
          Notifications are blocked. A page cannot ask twice, so this has to be
          changed in Settings → Notifications → Tempo on the device itself.
        </p>
      )}

      {state === 'off' && (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-mute">
            Reminders arrive even when Tempo is closed. Each entry carries its
            own lead times; this switch is what lets this device receive them.
          </p>
          <Button type="button" variant="primary" disabled={busy} onClick={() => run(enable)}>
            {busy ? 'ASKING…' : 'ENABLE'}
          </Button>
        </div>
      )}

      {state === 'on' && (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-mute">
            This device is subscribed. Reminders come from the server, so they
            arrive whether or not the app is open.
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={sendTest}>
              SEND A TEST
            </Button>
            <Button type="button" variant="quiet" disabled={busy} onClick={() => run(disable)}>
              TURN OFF
            </Button>
          </div>
        </div>
      )}

      {note && <p className="label mt-3 leading-relaxed">{note}</p>}
    </Section>
  );
}
