import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest runs the feature-slice unit tests (lib/**/*.test.ts). jsdom gives the
// mock slices a localStorage to round-trip through. The "@/..." alias mirrors
// tsconfig so tests import the same way the app does.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["lib/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
