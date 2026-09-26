import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Обычная сборка кладёт файлы в dist/.
// Режим standalone (npm run build:standalone) собирает ВСЮ игру в один HTML-файл
// standalone/index.html — его можно открыть без сервера и без npm.
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    base: './',
    plugins: [react(), tailwindcss(), ...(standalone ? [viteSingleFile()] : [])],
    // React + Framer Motion + иконки дают ~600 КБ (≈180 КБ gzip) — для игры это нормально.
    build: standalone
      ? { outDir: 'standalone', emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 800 }
      : { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
  };
});
