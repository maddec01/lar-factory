// A dialog form's result. It stays mounted, as a live region, so screen readers hear each new message.

import type { ReactNode } from 'react';
import { Alert } from '@lar-factory/ui/design-system/Alert';

/** Empty, it has no border, padding or icon. With no tone it's a warning, as a validation message is. */
export function FormResult({ id, text, tone = 'warning', children }: {
  id: string;
  text: string;
  tone?: 'success' | 'warning' | 'error' | undefined;
  /** Shown under the text. */
  children?: ReactNode;
}) {
  return (
    <Alert id={id} tone={tone === 'error' ? 'danger' : tone} data-tone={tone} role="status" aria-atomic="true" showIcon={Boolean(text)}
      className={text ? 'wrap-anywhere whitespace-pre-line' : 'border-0 p-0'}>
      {text && <>{text}{children}</>}
    </Alert>
  );
}
