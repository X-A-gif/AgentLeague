import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/desk/**/*.test.ts", "apps/web/**/*.test.tsx"],
  },
});
