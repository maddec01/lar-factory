// The board's toast manager and viewport: toast.create adds a toast and toast.dismiss closes it.
// The design system's own notifications call ninna-ui's toast from inside it; the board reaches ninna-ui
// only through this package.

export { toast, Toaster } from '@ninna-ui/feedback';
