import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Интерфейс целиком по-русски. Когда игру встраивают в чужую страницу, <html>
// приходит оттуда без lang — без него экранные дикторы читают русский чужим голосом.
if (!document.documentElement.lang) document.documentElement.lang = 'ru';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
