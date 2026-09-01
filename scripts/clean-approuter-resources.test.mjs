import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import test from "node:test";

import { cleanApprouterResources } from "./clean-approuter-resources.mjs";

function removeOwnedFixture(fixture) {
  const resolvedTemp = resolve(tmpdir());
  const resolvedFixture = resolve(fixture);
  if (
    !resolvedFixture.startsWith(`${resolvedTemp}${sep}`) ||
    !basename(resolvedFixture).startsWith("flowpilot-resource-clean-")
  ) {
    throw new Error("Refusing to remove an unexpected test fixture path.");
  }
  rmSync(resolvedFixture, { force: true, recursive: true });
}

test("removes generated AppRouter resources without touching the repository boundary", () => {
  const fixture = mkdtempSync(join(tmpdir(), "flowpilot-resource-clean-"));
  try {
    const resources = join(fixture, "apps", "approuter", "resources");
    mkdirSync(join(resources, "assets"), { recursive: true });
    writeFileSync(join(resources, ".gitkeep"), "");
    writeFileSync(join(resources, "index.html"), "generated");
    writeFileSync(join(resources, "assets", "old.css"), "generated");
    writeFileSync(join(fixture, "outside.txt"), "preserve");

    assert.deepEqual(cleanApprouterResources(fixture), [
      "assets",
      "index.html",
    ]);
    assert.deepEqual(readdirSync(resources), [".gitkeep"]);
    assert.equal(existsSync(join(fixture, "outside.txt")), true);
  } finally {
    removeOwnedFixture(fixture);
  }
});

test("refuses a repository root without the exact resource directory", () => {
  const fixture = mkdtempSync(join(tmpdir(), "flowpilot-resource-clean-"));
  try {
    assert.throws(() => cleanApprouterResources(fixture));
  } finally {
    removeOwnedFixture(fixture);
  }
});
