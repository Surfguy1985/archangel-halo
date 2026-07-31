import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Service worker registration and update checks live in
// src/components/UpdatePrompt.tsx (useRegisterSW prompt flow) — the single
// registration path. Do not add a second registerSW call here.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);