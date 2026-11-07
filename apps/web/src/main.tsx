// The page's entry for Vite+: the board's styles, with Tailwind, and the React app, which first
// paints the board data the server put in the page and then keeps it live.

import './index.css';

import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/App';
import { AppProviders } from '@/app/providers/AppProviders';
import { startLiveData } from '@/services/board/board.service';

// The script holds the first paint (vite.config.ts), so render now, not in a later task: the first
// frame then shows the board.
const root = createRoot(document.getElementById('app')!);

flushSync(() =>
    root.render(
        <StrictMode>
            <AppProviders>
                <App />
            </AppProviders>
        </StrictMode>,
    ),
);
startLiveData();
