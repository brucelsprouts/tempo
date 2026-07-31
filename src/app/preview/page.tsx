import { notFound } from 'next/navigation';
import { PreviewHarness } from './harness';

/**
 * Development-only design harness.
 *
 * Lets the calendar be worked on against fixture data without a live session.
 * Returns 404 anywhere but development, and `proxy.ts` only exempts this path
 * from the auth gate in development too.
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <PreviewHarness />;
}
