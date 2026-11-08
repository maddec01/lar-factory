import type { TicketOptions } from '@lar-factory/shared';
// A persisted submission survives closing details or losing the server response.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useBoardStore } from '@/services/board/board.hooks';
import { receive } from '@/services/board/board.service';
import { submitTicket, type TicketPreview } from '@/services/tickets/tickets.service';

interface Attempt {
    requestId: string;
    preview: TicketPreview;
    options: TicketOptions;
    phase: 'pending' | 'retry' | 'uncertain' | 'failed';
    message: string;
}
interface CreateTicketState {
    attempts: Record<string, Attempt>;
    submit: (itemId: string, preview: TicketPreview, options: TicketOptions) => Promise<void>;
}
export const useCreateTicketStore = create<CreateTicketState>()(
    persist(
        (set, get) => ({
            attempts: {},
            submit: async (itemId, preview, options) => {
                const prior = get().attempts[itemId];

                if (prior?.phase === 'pending' || prior?.phase === 'uncertain') return;

                const attempt =
                    prior?.phase === 'retry'
                        ? prior
                        : { requestId: crypto.randomUUID(), preview, options, phase: 'pending' as const, message: '' };
                const keep = (phase: Attempt['phase'], message: string) =>
                    set((state) => ({ attempts: { ...state.attempts, [itemId]: { ...attempt, phase, message } } }));

                keep('pending', 'Creating issue…');
                useBoardStore.getState().beginWrite();

                try {
                    const { status, result } = await submitTicket({
                        itemId,
                        requestId: attempt.requestId,
                        revision: attempt.preview.revision,
                        preview: attempt.preview,
                        options: attempt.options,
                        session: useBoardStore.getState().data.capture?.session,
                    });

                    if (result.item && result.board) {
                        receive(result);
                        set((state) => {
                            const attempts = { ...state.attempts };

                            delete attempts[itemId];

                            return { attempts };
                        });
                    } else
                        keep(
                            result.uncertain ? 'uncertain' : 'failed',
                            result.error ?? `Request failed (HTTP ${status}).`,
                        );
                } catch {
                    keep(
                        'retry',
                        'The response was lost. Retry this submission to recover its result without creating another issue.',
                    );
                }
            },
        }),
        {
            name: 'lar-board:create-ticket',
            partialize: ({ attempts }) => ({ attempts }),
            merge: (saved, current) => ({
                ...current,
                attempts: Object.fromEntries(
                    Object.entries((saved as Partial<CreateTicketState>).attempts ?? {}).map(([id, attempt]) => [
                        id,
                        attempt.phase === 'pending'
                            ? {
                                  ...attempt,
                                  phase: 'retry',
                                  message:
                                      'The response was lost. Retry this submission to recover its result without creating another issue.',
                              }
                            : attempt,
                    ]),
                ),
            }),
        },
    ),
);
