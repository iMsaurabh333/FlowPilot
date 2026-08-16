import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { build } from "esbuild";

const packageDirectory = fileURLToPath(new URL(".", import.meta.url));
const outputDirectory = join(packageDirectory, "dist");

await rm(outputDirectory, { recursive: true, force: true });

await build({
  absWorkingDir: packageDirectory,
  entryPoints: ["./src/server.ts"],
  bundle: true,
  format: "esm",
  outfile: "./dist/server.js",
  packages: "external",
  platform: "node",
  sourcemap: true,
  target: "node24",
});
