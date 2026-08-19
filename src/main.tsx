import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
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
