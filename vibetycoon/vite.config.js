import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Сборка в один автономный index.html: его можно открыть двойным кликом,
// без сервера и без интернета (кроме шрифта Google Fonts, у которого есть фолбэк).
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  base: './',
});
