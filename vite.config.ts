import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  test: { include: ["src/**/*.test.ts"] },
});
