// The toast manager the copied Notifications shows: toast.create adds a toast and toast.dismiss closes it.
// lar-server's Copies call ninna-ui's toast straight from their feature code; the board reaches ninna-ui
// only through this package.

export { toast } from '@ninna-ui/feedback';
