// The page's entry for Vite+: the board's styles, with Tailwind, and the React app, which first
// paints the board data the server put in the page and then keeps it live.

import './styles.css';
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './app/router.tsx';
import { startLiveData } from './app/live-data.ts';

// The script holds the first paint (vite.config.ts), so render now, not in a later task: the first
// frame then shows the board.
const root = createRoot(document.getElementById('app')!);
flushSync(() =>
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  ),
);
startLiveData();
