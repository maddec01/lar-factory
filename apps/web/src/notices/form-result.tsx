// A dialog form's result. It stays mounted, as a live region, so screen readers hear each new message.

import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@lar-factory/ui/alert';

/** Empty, it has no border or padding. With no tone it's a warning, as a validation message is. */
export function FormResult({ id, text, tone = 'warning', children }: {
  id: string;
  text: string;
  tone?: 'success' | 'warning' | 'error' | undefined;
  /** Shown under the text. */
  children?: ReactNode;
}) {
  return (
    <Alert id={id} variant={tone} role="status" aria-live="polite" aria-atomic="true"
      className={text ? 'wrap-anywhere whitespace-pre-line' : 'border-0 p-0'}>
      {text && <AlertDescription>{text}{children}</AlertDescription>}
    </Alert>
  );
}
