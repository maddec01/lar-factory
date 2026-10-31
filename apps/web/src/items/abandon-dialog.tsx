// Abandon's confirmation: it names the item it sets aside on this Mac. For ticketed work a second step asks whether to
// close its ticket too, which only its own confirm does. Cancel, Close or Escape closes it and focus goes back to
// Abandon; a click outside leaves it open.

import { abandonPrompt, closeTicketPrompt } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { useAbandonStore } from './abandon-store.ts';
import { abandonItem, closeTicket } from './card-actions.ts';
import { kind } from '../buttons/button-kinds.tsx';

export function AbandonDialog() {
  const { open, item, step, close } = useAbandonStore();
  if (!open || !item) return null;
  const closing = step === 'close-ticket';
  const prompt = closing ? closeTicketPrompt(item) : abandonPrompt(item);
  const confirm = () => {
    close();
    void (closing ? closeTicket(item) : abandonItem(item.id));
  };
  return (
    <Modal onClose={close}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the detail names itself. */}
      <Modal.Content id="abandon-dialog" role="alertdialog" title={prompt.question} description={closing ? 'Close its ticket.' : 'Set this item aside.'}
        aria-describedby="abandon-detail" closeOnOverlayClick={false} data-abandon-step={step}>
        <Modal.Body><Text id="abandon-detail" tone="muted">{prompt.detail}</Text></Modal.Body>
        <Modal.Footer>
          <Button {...kind('other')} onClick={close}>{closing ? closeTicketPrompt(item).keep : 'Cancel'}</Button>
          <Button {...kind('main', 'danger')} onClick={confirm}>{prompt.confirm}</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}
