import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useTheme } from './hooks/useTheme';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

/**
 * ThemeApplier — runs the useTheme side-effect once at mount.
 * Renders nothing. Lives outside <App /> so its effect persists
 * across stage transitions inside App.
 */
function ThemeApplier() {
  useTheme();
  return null;
}

createRoot(rootEl).render(
  <StrictMode>
    <ThemeApplier />
    <App />
  </StrictMode>,
);
