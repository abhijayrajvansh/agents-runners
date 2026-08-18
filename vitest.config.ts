import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "web/**/*.test.ts", "web/**/*.test.tsx"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    restoreMocks: true
  }
});
