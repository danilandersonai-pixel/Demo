import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        → обычная сборка в dist/
// `npm run build:single` → вся игра в одном HTML-файле (dist-single/index.html),
//                          удобно для превью и отправки одним файлом.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    // Игра — одна страница без маршрутов: единый бандл (React + Framer Motion + игра)
    // осознанно больше стандартного порога в 500 кБ, дробить его незачем.
    chunkSizeWarningLimit: 900,
  },
}));
