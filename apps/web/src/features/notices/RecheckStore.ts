// The notices' Recheck: asks the server to check every command again, and keeps what it found
// while the checks are still the ones it answered, so an old note never heads a new notice.

import type { BoardData } from '@lar-factory/shared';
import { flushSync } from 'react-dom';
import { create } from 'zustand';

import { refocus } from './Toasts';
import { postAction, receive } from '@/features/items/CardActions';
import { useBoardStore } from '@/services/board/board.hooks';

/** A Recheck's answer: the error when it failed, else null, and the checks it left, serialised. */
interface RecheckAnswer {
    error: string | null;
    tools: string;
}

const toolsOf = (data: BoardData) => JSON.stringify(data.tools ?? {});

interface RecheckState {
    /** Set while this page's Recheck runs. */
    checking: boolean;
    /** Set once this page's Recheck answered, while the checks are the ones it answered. */
    answer: RecheckAnswer | undefined;
    recheck: () => Promise<void>;
}

export const useRecheckStore = create<RecheckState>()((set, get) => ({
    checking: false,
    answer: undefined,
    recheck: async () => {
        if (get().checking) return;

        set({ checking: true });

        const result = await postAction('/api/recheck', {});

        flushSync(() => {
            receive(result);
            set({ checking: false, answer: { error: result.error, tools: toolsOf(useBoardStore.getState().data) } });
        });
        // The button was disabled while checking, which dropped its focus.
        refocus(['[data-recheck]']);
    },
}));

// New board data from the server answers a failed Recheck's "can't reach" too, so its note goes;
// a note that found a problem goes once the checks change.
useBoardStore.subscribe((state, prev) => {
    if (state.receives === prev.receives) return;

    const { answer } = useRecheckStore.getState();

    if (answer && (answer.error || answer.tools !== toolsOf(state.data)))
        useRecheckStore.setState({ answer: undefined });
});
