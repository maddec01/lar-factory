// A button that copies its text and says Copied for a moment, and the live region that announces it.

import { useEffect, useState } from 'react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useCopyStore } from './copy-store.ts';

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for previews without clipboard permission.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(0);
  const announce = useCopyStore((state) => state.announce);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(0), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    await writeClipboard(text);
    setCopied(Date.now());
    announce();
  };
  return <Button variant="secondary" aria-label={label} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>;
}

export function CopyStatus() {
  const announcement = useCopyStore((state) => state.announcement);
  return <div id="copy-status" className="sr-only" role="status" aria-live="polite">{announcement}</div>;
}
