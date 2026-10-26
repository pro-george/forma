import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useStore } from './state/store';
import { useSketch } from './state/sketch';
import { useViewStore } from './state/view';
import './styles.css';

// test/debug hook (used by the e2e smoke test)
(window as unknown as { __forma: unknown }).__forma = { useStore, useSketch, useViewStore };

// worker or async failures surface as a toast instead of dying silently
window.addEventListener('unhandledrejection', (e) => { try { useStore.getState().toast(`Error: ${(e.reason as Error)?.message ?? e.reason}`, 'error'); } catch { /* store not ready */ } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
