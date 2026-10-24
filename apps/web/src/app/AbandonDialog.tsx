// Abandon's confirmation: it names the item it deletes or removes. Cancel, Escape or a click
// outside closes it and focus goes back to Abandon; the confirm button abandons the item.

import { AlertDialog } from '@base-ui/react/alert-dialog';
import { abandonPrompt } from '../../../server/src/board-view.ts';
import { useAbandonStore } from './abandon-store.ts';
import { abandonItem } from './card-actions.ts';

export function AbandonDialog() {
  const { open, item, close } = useAbandonStore();
  const prompt = item && abandonPrompt(item);
  const confirm = () => {
    close();
    if (item) void abandonItem(item.id);
  };
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="dialog-backdrop" />
        <AlertDialog.Popup id="abandon-dialog">
          <div className="form-heading"><AlertDialog.Title id="abandon-heading">{prompt?.question}</AlertDialog.Title></div>
          <AlertDialog.Description className="form-hint" id="abandon-detail">{prompt?.detail}</AlertDialog.Description>
          <div className="form-actions">
            <AlertDialog.Close className="copy">Cancel</AlertDialog.Close>
            <button type="button" className="copy abandon" onClick={confirm}>{prompt?.confirm}</button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
