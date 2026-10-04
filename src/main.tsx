import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
/*
 * The two faces of the design, bundled rather than fetched: the app has to look
 * right in a basement with no signal. Latin subset only — it covers every
 * character the app shows (×, −, en dash, £) and keeps the precache small.
 */
import '@fontsource/big-shoulders-display/latin-600';
import '@fontsource/big-shoulders-display/latin-700';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/barlow/latin-400';
import '@fontsource/barlow/latin-500';
import '@fontsource/barlow/latin-600';
import '@fontsource/barlow/latin-700';
import './index.css';
import { startSync } from './sync/engine';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing from index.html');

// Started, never awaited. Sync runs behind the app from here on.
startSync();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
