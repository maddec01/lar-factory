// T3's DialogPopup, kept mounted while closed, so what the user typed into it survives a close and reopen.
// DialogPopup takes no keepMounted, and the Copy stays unchanged, so this builds the same popup from its parts.
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { Button } from '../components/ui/button.tsx';
import {
  DialogBackdrop,
  DialogPortal,
  DialogViewport,
  renderRetainedPopup,
} from '../components/ui/dialog.tsx';
import { DIALOG_MOBILE_SHEET_CLASS, DIALOG_POPUP_CLASS } from '../components/ui/dialog-styles.ts';
import { cn } from '../lib/utils.ts';

export function KeptMountedDialogPopup({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPortal keepMounted>
      <DialogBackdrop />
      <DialogViewport className="max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12">
        <DialogPrimitive.Popup
          className={cn(
            DIALOG_POPUP_CLASS,
            'row-start-2 text-popover-foreground max-h-full max-w-lg',
            DIALOG_MOBILE_SHEET_CLASS,
            className,
          )}
          data-slot="dialog-popup"
          render={renderRetainedPopup}
          {...props}
        >
          {children}
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute end-2 top-2"
            render={<Button size="icon" variant="ghost" />}
          >
            <XIcon />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}
