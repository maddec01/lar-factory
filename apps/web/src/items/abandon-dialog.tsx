// Abandon's confirmation: it names the item it deletes or removes. Cancel or Escape closes it and
// focus goes back to Abandon; a click outside leaves it open. The confirm button abandons the item.

import { abandonPrompt } from '@lar-factory/shared';
import {
  AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle,
} from '@lar-factory/ui/alert-dialog';
import { Button } from '@lar-factory/ui/button';
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
    <AlertDialog open={open} onOpenChange={(next) => !next && close()}>
      <AlertDialogPopup id="abandon-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle id="abandon-heading">{prompt?.question}</AlertDialogTitle>
          <AlertDialogDescription id="abandon-detail">{prompt?.detail}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="xs" />}>Cancel</AlertDialogClose>
          <Button variant="destructive" size="xs" onClick={confirm}>{prompt?.confirm}</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
