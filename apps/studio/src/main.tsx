import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './state/store';
import { useSketch } from './state/sketch';
import { useViewStore } from './state/view';
import './styles.css';

// test/debug hook (used by the e2e smoke test)
(window as unknown as { __forma: unknown }).__forma = { useStore, useSketch, useViewStore };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
