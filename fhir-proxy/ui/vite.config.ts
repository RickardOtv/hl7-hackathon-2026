import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite emits the bundle directly into Maven's resources tree so `mvn package`
// picks it up via process-resources → target/classes/static.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../src/main/resources/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/fhir': 'http://localhost:8181',
      '/fixtures': 'http://localhost:8181',
      '/transform': 'http://localhost:8181',
    },
  },
});
