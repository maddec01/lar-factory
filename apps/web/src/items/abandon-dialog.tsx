// Abandon keeps provider failures in the confirmation so work can still be set aside locally.

import { useState } from 'react';
import { abandonPrompt, closeTicketPrompt } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { useAbandonStore } from './abandon-store.ts';
import { abandonItem, postAction, receive, closeTicket } from './card-actions.ts';
import { kind } from '../buttons/button-kinds.tsx';

export function AbandonDialog() {
  const { open, item, step, close } = useAbandonStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open || !item) return null;
  const closing = step === 'close-ticket';
  const prompt = closing ? closeTicketPrompt(item) : abandonPrompt(item);
  const dismiss = () => { if (!pending) { setError(null); close(); } };
  const confirm = async (combined = false) => {
    if (pending) return;
    setPending(true);
    setError(null);
    if (closing) { await closeTicket(item); setPending(false); dismiss(); return; }
    if (!combined) { await abandonItem(item.id); setPending(false); close(); return; }
    let result = await postAction(combined ? '/api/abandon-and-close' : '/api/abandon', { itemId: item.id });
    if (result.error === "Can't reach the board server. Try again.") {
      result = await postAction('/api/abandon-and-close', { itemId: item.id });
      if (result.error === "Can't reach the board server. Try again.") result.error = 'The outcome is unknown. Restore the connection and try again to reconcile the work and ticket.';
    }
    receive(result);
    setPending(false);
    if (result.error) setError(result.error);
    else { setError(null); close(); }
  };
  return (
    <Modal onClose={dismiss}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the detail names itself. */}
      <Modal.Content id="abandon-dialog" role="alertdialog" title={prompt.question} description={closing ? 'Close its ticket.' : 'Set this item aside.'}
        aria-describedby="abandon-detail" closeOnOverlayClick={false} data-abandon-step={step}>
        <Modal.Body><Text id="abandon-detail" tone="muted">{prompt.detail}</Text>{item.abandonRefusal && <Text>{item.abandonRefusal}</Text>}{error && <Text role="alert">{error}</Text>}</Modal.Body>
        <Modal.Footer>
          <Button {...kind('other')} disabled={pending} onClick={dismiss}>{closing ? closeTicketPrompt(item).keep : 'Cancel'}</Button>
          <Button {...kind('main', 'danger')} disabled={pending} onClick={() => void confirm()}>{prompt.confirm}</Button>
          {!closing && !!item.number && !item.abandonRefusal && <Button {...kind('main', 'danger')} disabled={pending} onClick={() => void confirm(true)}>{pending ? 'Working…' : error ? 'Try again' : 'Abandon and close ticket'}</Button>}
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}
