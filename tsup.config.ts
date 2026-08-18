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
  noExternal: [/.*/]
});
