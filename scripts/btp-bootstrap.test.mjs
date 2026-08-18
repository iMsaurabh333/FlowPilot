import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

import {
  buildBootstrapPlan,
  parseArguments,
  readJsonProfile,
  repositoryRoot,
  validateBtpProfile,
  validateOperationsProfile,
} from "./btp-bootstrap.mjs";

const btpExample = join(
  repositoryRoot,
  "config",
  "environments",
  "btp.example.json",
);
const operationsExample = join(
  repositoryRoot,
  "config",
  "environments",
  "operations.example.json",
);

test("defaults to dry-run and rejects mutation flags", () => {
  assert.deepEqual(parseArguments([]), {
    help: false,
    mode: "dry-run",
    operationsProfile: null,
    profile: null,
  });
  assert.throws(
    () => parseArguments(["--deploy"]),
    /disabled during Checkpoint 3A/,
  );
  assert.throws(() => parseArguments(["--mode", "apply"]), /dry-run or verify/);
  assert.throws(
    () => parseArguments(["--unknown"]),
    /Unknown bootstrap argument/,
  );
});

test("validates the committed target and operations templates", () => {
  const btp = validateBtpProfile(readJsonProfile(btpExample).value);
  const operations = validateOperationsProfile(
    readJsonProfile(operationsExample).value,
  );
  assert.equal(btp.btp.region, "us10");
  assert.deepEqual(operations.dataProtection.schemas, [
    "flowpilot_app",
    "flowpilot_graph",
  ]);
  assert.equal(operations.modelCredential.provider, "groq");
});

test("rejects secret-bearing fields and likely provider keys", () => {
  assert.throws(
    () =>
      validateOperationsProfile({
        ...readJsonProfile(operationsExample).value,
        password: "not-allowed",
      }),
    /modelCredential|Secret-bearing/,
  );
  const temporary = structuredClone(readJsonProfile(operationsExample).value);
  temporary.modelCredential.credentialName = ["gsk", "1234567890abcdef"].join(
    "_",
  );
  assert.throws(
    () => validateOperationsProfile(temporary),
    /modelCredential|secret/i,
  );
});

test("plan contains explicit mutation and recovery gates", () => {
  const btp = validateBtpProfile(readJsonProfile(btpExample).value);
  const operations = validateOperationsProfile(
    readJsonProfile(operationsExample).value,
  );
  const plan = buildBootstrapPlan(btp, operations);
  assert.equal(plan.length, 9);
  assert.match(
    plan.find((step) => step.stage === "Application deployment").gate,
    /REFUSED/,
  );
  assert.match(
    plan.find((step) => step.stage === "Provider secret").gate,
    /No key/,
  );
  assert.match(
    plan.find((step) => step.stage === "Data recovery").gate,
    /approval/,
  );
});

test("CLI dry run prints the plan without identity values or external execution", () => {
  const result = spawnSync(
    process.execPath,
    [
      join(repositoryRoot, "scripts", "btp-bootstrap.mjs"),
      "--profile",
      btpExample,
      "--operations-profile",
      operationsExample,
    ],
    { cwd: repositoryRoot, encoding: "utf8", shell: false },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Mode: dry-run/);
  assert.match(result.stdout, /DEPLOYMENT.*DISABLED/);
  assert.match(result.stdout, /no external command or platform mutation ran/i);
  assert.doesNotMatch(result.stdout, /operator@example\.invalid/);
});
