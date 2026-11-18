import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Страница-хост (например, превью-песочница) может не выставить язык документа.
if (!document.documentElement.lang) document.documentElement.lang = 'ru';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
