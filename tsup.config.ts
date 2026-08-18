import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "bin/cli": "src/cli/index.ts",
    "bin/mcp": "src/mcp/server.ts"
  },
  format: ["esm"],
  outDir: "dist",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: false,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
  },
  outExtension: () => ({ js: ".mjs" }),
  noExternal: [/.*/]
});
