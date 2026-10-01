import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  input: ['index.html', 'ui-kit.html', 'ui-kit-day-schedule.html'],
});
