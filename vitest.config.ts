import path from "path";
import { defineConfig } from "vitest/config";

// Separate config so vite.config.ts (and its HMR/build settings) stays untouched.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Single React copy, mirroring the app config.
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
  esbuild: {
    target: "esnext",
  },
});
