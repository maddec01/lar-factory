// The board's toast manager and viewport: toast.create adds a toast and toast.dismiss closes it.
// lar-server's Copies call ninna-ui's toast straight from their feature code; the board reaches ninna-ui
// only through this package.

export { toast, Toaster } from '@ninna-ui/feedback';
