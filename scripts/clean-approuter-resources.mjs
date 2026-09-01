import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..");

export function cleanApprouterResources(root = repositoryRoot) {
  const realRoot = realpathSync(root);
  const target = resolve(realRoot, "apps", "approuter", "resources");
  const relativeTarget = relative(realRoot, target);
  if (
    relativeTarget !== join("apps", "approuter", "resources") ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    throw new Error("Refusing to clean an unexpected AppRouter resource path.");
  }

  const targetStatus = lstatSync(target);
  if (!targetStatus.isDirectory() || targetStatus.isSymbolicLink()) {
    throw new Error(
      "AppRouter resources must be a real directory inside the repository.",
    );
  }
  if (realpathSync(target) !== target) {
    throw new Error(
      "AppRouter resources resolved outside the expected repository path.",
    );
  }

  const removed = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === ".gitkeep") continue;
    rmSync(join(target, entry.name), { force: true, recursive: true });
    removed.push(entry.name);
  }
  return removed.sort();
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    const removed = cleanApprouterResources();
    console.log(
      `Prepared AppRouter resources: removed ${removed.length} generated entr${removed.length === 1 ? "y" : "ies"}.`,
    );
  } catch (error) {
    console.error(
      `AppRouter resource cleanup refused: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  }
}
