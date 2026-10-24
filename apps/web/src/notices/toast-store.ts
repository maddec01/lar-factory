// The toasts this page shows in the top-right corner. A toast that says what the page just did
// replaces the one before it in its slot; a failure stays until it is closed.

import { create } from 'zustand';
import type { ReactNode } from 'react';

export interface Toast {
  /** New for every toast, so a toast shown again starts its clock again. */
  key: string;
  /** One toast per slot: a new one replaces the last. */
  slot: string;
  /** A failure is an alert that stays until it's closed; a success clears itself after 5 s. */
  failed?: boolean;
  /** `error`, as T3's error toast: its dot is red rather than green. */
  tone?: 'error';
  /** Names the toast for its close button, such as "Moved #61". */
  what: string;
  body: ReactNode;
  /** Where keyboard focus goes when the toast closes while focus is in it: the first selector that matches. */
  focusAfter?: string[];
}

interface ToastState {
  toasts: Toast[];
  show: (toast: Omit<Toast, 'key'>) => void;
  /** Closes the toast with this key, if it's still shown. */
  dismiss: (key: string) => void;
  /** Closes whatever toast holds this slot. */
  clear: (slot: string) => void;
}

let count = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (toast) => set((state) => ({ toasts: [...state.toasts.filter((t) => t.slot !== toast.slot), { ...toast, key: `toast-${++count}` }] })),
  dismiss: (key) => set((state) => ({ toasts: state.toasts.filter((t) => t.key !== key) })),
  clear: (slot) => set((state) => ({ toasts: state.toasts.filter((t) => t.slot !== slot) })),
}));
