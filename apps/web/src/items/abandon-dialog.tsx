// Abandon's confirmation: it names the item it deletes or removes. Cancel, Close or Escape closes it and
// focus goes back to Abandon; a click outside leaves it open. The confirm button abandons the item.

import { abandonPrompt } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { useAbandonStore } from './abandon-store.ts';
import { abandonItem } from './card-actions.ts';
import { kind } from '../buttons/button-kinds.tsx';

export function AbandonDialog() {
  const { open, item, close } = useAbandonStore();
  if (!open || !item) return null;
  const prompt = abandonPrompt(item);
  const confirm = () => {
    close();
    void abandonItem(item.id);
  };
  return (
    <Modal onClose={close}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the detail names itself. */}
      <Modal.Content id="abandon-dialog" role="alertdialog" title={prompt.question} aria-describedby="abandon-detail" closeOnOverlayClick={false}>
        <Modal.Body><Text id="abandon-detail" tone="muted">{prompt.detail}</Text></Modal.Body>
        <Modal.Footer>
          <Button {...kind('other')} onClick={close}>Cancel</Button>
          <Button {...kind('main', 'danger')} onClick={confirm}>{prompt.confirm}</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}
