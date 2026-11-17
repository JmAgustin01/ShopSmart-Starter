// File: frontend/vite.config.js
import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // DEV_PORT has no VITE_ prefix, so it is read here but never copied into the browser bundle.
  // Default 5173 matches the README and FRONTEND_URL. On a laptop where Windows reserves 5173,
  // put DEV_PORT=3001 in frontend/.env (the backend allows any localhost port in development).
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // The React plugin turns JSX into code the browser can run
    plugins: [react()],
    server: {
      port: Number(env.DEV_PORT || 5173),
      strictPort: true // fail loudly instead of silently moving to another port the README does not mention
    }
  };
});
