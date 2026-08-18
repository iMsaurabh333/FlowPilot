import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..");

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedRoleCollections = new Set([
  "FlowPilotAdmins",
  "FlowPilotOperators",
  "FlowPilotUsers",
]);
const allowedProviders = new Set(["anthropic", "groq", "openai"]);
const prohibitedSecretKey =
  /^(apiKey|authorization|bearerToken|connectionString|databaseUrl|password|privateKey|secret|secretValue|token)$/i;
const likelySecretValue =
  /(?:^|[^a-z0-9])(?:gsk_|sk-ant-|sk-proj-)[a-z0-9_-]{8,}/i;

function fail(message) {
  throw new Error(message);
}

function plainObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function booleanValue(value, label) {
  if (typeof value !== "boolean") {
    fail(`${label} must be true or false.`);
  }
  return value;
}

function optionalString(value, label) {
  if (value === null || value === undefined) {
    return null;
  }
  return nonEmptyString(value, label);
}

function assertNoSecretMaterial(value, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSecretMaterial(item, [...trail, index]),
    );
    return;
  }
  if (typeof value !== "object" || value === null) {
    if (typeof value === "string" && likelySecretValue.test(value)) {
      fail(
        `Likely provider secret found at ${trail.join(".") || "profile root"}.`,
      );
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const path = [...trail, key];
    if (prohibitedSecretKey.test(key)) {
      fail(
        `Secret-bearing field '${path.join(".")}' is prohibited in bootstrap profiles.`,
      );
    }
    assertNoSecretMaterial(nested, path);
  }
}

export function readJsonProfile(filePath) {
  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) {
    fail(`Profile not found: ${absolutePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    fail(`Profile is not valid JSON: ${absolutePath}`);
  }
  assertNoSecretMaterial(parsed);
  return { absolutePath, value: parsed };
}

export function validateBtpProfile(input) {
  assertNoSecretMaterial(input);
  const profile = plainObject(input, "BTP profile");
  if (profile.schemaVersion !== 1) {
    fail("BTP profile schemaVersion must be 1.");
  }
  const btp = plainObject(profile.btp, "btp");
  const cloudFoundry = plainObject(profile.cloudFoundry, "cloudFoundry");

  const normalized = {
    schemaVersion: 1,
    btp: {
      globalAccountId: nonEmptyString(
        btp.globalAccountId,
        "btp.globalAccountId",
      ),
      globalAccountSubdomain: nonEmptyString(
        btp.globalAccountSubdomain,
        "btp.globalAccountSubdomain",
      ),
      subaccountId: nonEmptyString(btp.subaccountId, "btp.subaccountId"),
      subaccountName: nonEmptyString(btp.subaccountName, "btp.subaccountName"),
      subaccountSubdomain: nonEmptyString(
        btp.subaccountSubdomain,
        "btp.subaccountSubdomain",
      ),
      region: nonEmptyString(btp.region, "btp.region"),
    },
    cloudFoundry: {
      apiEndpoint: nonEmptyString(
        cloudFoundry.apiEndpoint,
        "cloudFoundry.apiEndpoint",
      ),
      environmentInstanceId: nonEmptyString(
        cloudFoundry.environmentInstanceId,
        "cloudFoundry.environmentInstanceId",
      ),
      landscape: nonEmptyString(
        cloudFoundry.landscape,
        "cloudFoundry.landscape",
      ),
      organization: nonEmptyString(
        cloudFoundry.organization,
        "cloudFoundry.organization",
      ),
      space: nonEmptyString(cloudFoundry.space, "cloudFoundry.space"),
    },
  };

  for (const [label, value] of [
    ["btp.globalAccountId", normalized.btp.globalAccountId],
    ["btp.subaccountId", normalized.btp.subaccountId],
    [
      "cloudFoundry.environmentInstanceId",
      normalized.cloudFoundry.environmentInstanceId,
    ],
  ]) {
    if (!uuidPattern.test(value)) {
      fail(`${label} must be a UUID.`);
    }
  }
  let apiUrl;
  try {
    apiUrl = new URL(normalized.cloudFoundry.apiEndpoint);
  } catch {
    fail("cloudFoundry.apiEndpoint must be a valid HTTPS URL.");
  }
  if (apiUrl.protocol !== "https:") {
    fail("cloudFoundry.apiEndpoint must use HTTPS.");
  }
  if (!/^[a-z]{2}[0-9]{2}$/.test(normalized.btp.region)) {
    fail("btp.region must look like us10 or eu10.");
  }
  return normalized;
}

export function validateOperationsProfile(input) {
  assertNoSecretMaterial(input);
  const profile = plainObject(input, "Operations profile");
  if (profile.schemaVersion !== 1) {
    fail("Operations profile schemaVersion must be 1.");
  }
  const roles = plainObject(profile.roleAssignments, "roleAssignments");
  const modelCredential = plainObject(
    profile.modelCredential,
    "modelCredential",
  );
  const dataProtection = plainObject(profile.dataProtection, "dataProtection");
  const additional = roles.additional;
  if (!Array.isArray(additional)) {
    fail("roleAssignments.additional must be an array.");
  }

  const normalizedAdditional = additional.map((entry, index) => {
    const item = plainObject(entry, `roleAssignments.additional[${index}]`);
    const roleCollectionName = nonEmptyString(
      item.roleCollectionName,
      `roleAssignments.additional[${index}].roleCollectionName`,
    );
    if (!allowedRoleCollections.has(roleCollectionName)) {
      fail(`Unsupported FlowPilot role collection: ${roleCollectionName}.`);
    }
    return {
      key: nonEmptyString(item.key, `roleAssignments.additional[${index}].key`),
      roleCollectionName,
      userName: nonEmptyString(
        item.userName,
        `roleAssignments.additional[${index}].userName`,
      ),
      origin: optionalString(
        item.origin,
        `roleAssignments.additional[${index}].origin`,
      ),
    };
  });
  if (
    new Set(normalizedAdditional.map((entry) => entry.key)).size !==
    normalizedAdditional.length
  ) {
    fail("roleAssignments.additional keys must be unique.");
  }

  const provider = nonEmptyString(
    modelCredential.provider,
    "modelCredential.provider",
  ).toLowerCase();
  if (!allowedProviders.has(provider)) {
    fail(`Unsupported model provider metadata: ${provider}.`);
  }
  const schemas = dataProtection.schemas;
  if (!Array.isArray(schemas)) {
    fail("dataProtection.schemas must be an array.");
  }
  const normalizedSchemas = schemas.map((schema, index) =>
    nonEmptyString(schema, `dataProtection.schemas[${index}]`),
  );
  for (const requiredSchema of ["flowpilot_app", "flowpilot_graph"]) {
    if (!normalizedSchemas.includes(requiredSchema)) {
      fail(`dataProtection.schemas must include ${requiredSchema}.`);
    }
  }
  if (dataProtection.backupFormat !== "flowpilot-logical-v1") {
    fail("dataProtection.backupFormat must be flowpilot-logical-v1.");
  }
  if (dataProtection.encryption !== "age") {
    fail("dataProtection.encryption must be age.");
  }
  if (dataProtection.restoreTargetMustBeEmpty !== true) {
    fail("dataProtection.restoreTargetMustBeEmpty must remain true.");
  }
  if (dataProtection.identityMappingReviewRequired !== true) {
    fail("dataProtection.identityMappingReviewRequired must remain true.");
  }

  return {
    schemaVersion: 1,
    roleAssignments: {
      validateCollections: booleanValue(
        roles.validateCollections,
        "roleAssignments.validateCollections",
      ),
      assignCurrentUserAsAdmin: booleanValue(
        roles.assignCurrentUserAsAdmin,
        "roleAssignments.assignCurrentUserAsAdmin",
      ),
      currentUserName: optionalString(
        roles.currentUserName,
        "roleAssignments.currentUserName",
      ),
      currentUserIdentityProviderOrigin: optionalString(
        roles.currentUserIdentityProviderOrigin,
        "roleAssignments.currentUserIdentityProviderOrigin",
      ),
      additional: normalizedAdditional,
    },
    modelCredential: {
      provider,
      serviceInstance: nonEmptyString(
        modelCredential.serviceInstance,
        "modelCredential.serviceInstance",
      ),
      namespace: nonEmptyString(
        modelCredential.namespace,
        "modelCredential.namespace",
      ),
      credentialName: nonEmptyString(
        modelCredential.credentialName,
        "modelCredential.credentialName",
      ),
      credentialType: nonEmptyString(
        modelCredential.credentialType,
        "modelCredential.credentialType",
      ),
    },
    dataProtection: {
      databaseServiceInstance: nonEmptyString(
        dataProtection.databaseServiceInstance,
        "dataProtection.databaseServiceInstance",
      ),
      schemas: normalizedSchemas,
      backupFormat: dataProtection.backupFormat,
      encryption: dataProtection.encryption,
      externalOutputDirectory: nonEmptyString(
        dataProtection.externalOutputDirectory,
        "dataProtection.externalOutputDirectory",
      ),
      restoreTargetMustBeEmpty: true,
      identityMappingReviewRequired: true,
    },
  };
}

export function parseArguments(argv) {
  const options = {
    help: false,
    mode: "dry-run",
    operationsProfile: null,
    profile: null,
  };
  const forbidden = new Set([
    "--apply",
    "--backup",
    "--deploy",
    "--execute",
    "--restore",
    "--secret",
    "--yes",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (forbidden.has(argument)) {
      fail(`${argument} is disabled during Checkpoint 3A.`);
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (
      argument === "--mode" ||
      argument === "--profile" ||
      argument === "--operations-profile"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        fail(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === "--mode") options.mode = value;
      if (argument === "--profile") options.profile = value;
      if (argument === "--operations-profile")
        options.operationsProfile = value;
      continue;
    }
    fail(`Unknown bootstrap argument: ${argument}`);
  }
  if (!new Set(["dry-run", "verify"]).has(options.mode)) {
    fail("--mode must be dry-run or verify during Checkpoint 3A.");
  }
  return options;
}

function defaultProfilePath(root, localName, exampleName) {
  const local = join(root, "config", "environments", localName);
  return existsSync(local)
    ? local
    : join(root, "config", "environments", exampleName);
}

export function resolveProfilePaths(options, root = repositoryRoot) {
  return {
    btp: resolve(
      root,
      options.profile ??
        defaultProfilePath(root, "btp.local.json", "btp.example.json"),
    ),
    operations: resolve(
      root,
      options.operationsProfile ??
        defaultProfilePath(
          root,
          "operations.local.json",
          "operations.example.json",
        ),
    ),
  };
}

export function buildBootstrapPlan(btp, operations) {
  return [
    {
      stage: "Preflight",
      effect: "read-only",
      action:
        "Validate repository, profile schemas, tools, and locked versions.",
      gate: "Stop on missing/ambiguous inputs.",
    },
    {
      stage: "Authenticate",
      effect: "human session",
      action: `Confirm BTP ${btp.btp.globalAccountSubdomain} and CF ${btp.cloudFoundry.organization}/${btp.cloudFoundry.space}.`,
      gate: "Human completes SSO/MFA; no credential is captured.",
    },
    {
      stage: "Account prerequisites",
      effect: "read-only then gated cloud mutation",
      action:
        "Run Terraform discovery, review missing entitlements, and prepare an import/create plan.",
      gate: "Terraform apply is disabled in Checkpoint 3A.",
    },
    {
      stage: "Application verification",
      effect: "local reversible",
      action:
        "Restore locked dependencies, run tests, build strict MTA, inspect/hash the MTAR.",
      gate: "Stop on any verification failure.",
    },
    {
      stage: "Application deployment",
      effect: "cloud mutation",
      action:
        "Deploy the reviewed versioned MTAR and verify services/bindings/routes.",
      gate: "REFUSED: live deployment remains Checkpoint 4.",
    },
    {
      stage: "Access",
      effect: "read-only then gated cloud mutation",
      action: `Validate role collections; preview ${operations.roleAssignments.additional.length + (operations.roleAssignments.assignCurrentUserAsAdmin ? 1 : 0)} requested assignment(s).`,
      gate: "Assignment apply requires human review and duplicate-user check.",
    },
    {
      stage: "Provider secret",
      effect: "human secret entry",
      action: `Create or rotate ${operations.modelCredential.namespace}/${operations.modelCredential.credentialName} in ${operations.modelCredential.serviceInstance}.`,
      gate: "No key may enter this command, profile, Terraform, MTA, log, or chat.",
    },
    {
      stage: "Data recovery",
      effect: "private-data read/write",
      action: `Verify encrypted ${operations.dataProtection.backupFormat} backup/restore for ${operations.dataProtection.schemas.join(" + ")}.`,
      gate: "Backup, restore, identity mapping, binding switch, and deletion each need approval.",
    },
    {
      stage: "Acceptance",
      effect: "read-only application checks",
      action:
        "Verify auth, health, private persistence, isolation, provider call, and rollback evidence.",
      gate: "Checkpoint 4 human acceptance remains required.",
    },
  ];
}

function executableCandidates(name, root) {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const windows = process.platform === "win32";
  const npmCliCandidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(programFiles, "nodejs", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate) => candidate && existsSync(candidate));
  const candidates = {
    btp: windows
      ? [
          ...(localAppData
            ? [join(localAppData, "Programs", "btpcli", "btp.exe")]
            : []),
          "btp.exe",
          "btp",
        ]
      : ["btp"],
    cf: windows
      ? [join(programFiles, "Cloud Foundry", "cf.exe"), "cf.exe", "cf"]
      : ["cf"],
    git: windows ? ["git.exe", "git"] : ["git"],
    make: windows
      ? [
          join(programFilesX86, "GnuWin32", "bin", "make.exe"),
          "make.exe",
          "make",
        ]
      : ["make", "gmake"],
    mbt: [
      {
        command: process.execPath,
        prefixArgs: [join(root, "node_modules", "mbt", "bin", "mbt")],
      },
      ...(windows ? [] : [join(root, "node_modules", ".bin", "mbt"), "mbt"]),
    ],
    npm: [
      ...npmCliCandidates.map((npmCli) => ({
        command: process.execPath,
        prefixArgs: [npmCli],
      })),
      ...(windows ? [] : ["npm"]),
    ],
    terraform: windows
      ? [
          ...(localAppData
            ? [join(localAppData, "Programs", "terraform", "terraform.exe")]
            : []),
          "terraform.exe",
          "terraform",
        ]
      : ["terraform"],
  };
  return candidates[name];
}

function spawnBounded(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: false,
    timeout: options.timeout ?? 20_000,
    windowsHide: true,
  });
  return result;
}

function resolveExecutable(name, versionArgs, root) {
  for (const rawCandidate of executableCandidates(name, root)) {
    const candidate =
      typeof rawCandidate === "string"
        ? { command: rawCandidate, prefixArgs: [] }
        : rawCandidate;
    if (isAbsolute(candidate.command) && !existsSync(candidate.command))
      continue;
    if (
      candidate.prefixArgs.some(
        (argument) => isAbsolute(argument) && !existsSync(argument),
      )
    ) {
      continue;
    }
    const result = spawnBounded(
      candidate.command,
      [...candidate.prefixArgs, ...versionArgs],
      { cwd: root },
    );
    if (result.error?.code === "ENOENT") continue;
    if (result.error) {
      return {
        name,
        command: candidate.command,
        ok: false,
        detail: result.error.code ?? "probe failed",
      };
    }
    if (result.status !== 0) {
      return {
        name,
        command: candidate.command,
        ok: false,
        detail: `exit ${result.status}`,
      };
    }
    const version = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return {
      name,
      command: candidate.command,
      ok: true,
      detail: version ?? "available",
    };
  }
  return { name, command: null, ok: false, detail: "not found" };
}

export function verifyReadOnlyEnvironment(
  btp,
  root = repositoryRoot,
  onProgress = () => {},
) {
  onProgress("Verifying locked toolchain versions...");
  const mbtProbe = resolveExecutable("mbt", ["--version"], root);
  if (mbtProbe.ok) {
    const mbtPackage = JSON.parse(
      readFileSync(join(root, "node_modules", "mbt", "package.json"), "utf8"),
    );
    mbtProbe.detail = `wrapper ${mbtPackage.version}; native ${mbtProbe.detail}`;
  }
  const tools = [
    {
      name: "node",
      ok: process.versions.node.startsWith("24."),
      detail: process.version,
      command: process.execPath,
    },
    resolveExecutable("npm", ["--version"], root),
    resolveExecutable("git", ["--version"], root),
    resolveExecutable("cf", ["version"], root),
    resolveExecutable("btp", ["--version"], root),
    resolveExecutable("terraform", ["version"], root),
    resolveExecutable("make", ["--version"], root),
    mbtProbe,
  ];
  const failures = tools.filter((tool) => !tool.ok);
  if (failures.length > 0) {
    fail(
      `Tool verification failed: ${failures.map((tool) => `${tool.name} (${tool.detail})`).join(", ")}`,
    );
  }

  const expectedTerraform = readFileSync(
    join(root, ".terraform-version"),
    "utf8",
  ).trim();
  const requiredVersionPatterns = {
    node: /^v24\./,
    cf: /version 8\./i,
    btp: /client v2\./i,
    terraform: new RegExp(
      `Terraform v${expectedTerraform.replaceAll(".", "\\.")}`,
    ),
    make: /GNU Make/i,
    mbt: /wrapper 1\.2\.49; native Cloud MTA Build Tool version 1\.2\.47/i,
  };
  for (const [name, pattern] of Object.entries(requiredVersionPatterns)) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!pattern.test(tool.detail)) {
      fail(
        `Tool compatibility check failed for ${name}; found '${tool.detail}'.`,
      );
    }
  }

  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  onProgress("Toolchain ready; checking the BTP CLI target...");
  const btpTarget = spawnBounded(byName.btp.command, ["target"], { cwd: root });
  if (btpTarget.error || btpTarget.status !== 0) {
    fail(
      "BTP target verification failed; refresh browser SSO with btp login --sso.",
    );
  }
  if (
    !String(btpTarget.stdout)
      .toLowerCase()
      .includes(btp.btp.globalAccountSubdomain.toLowerCase())
  ) {
    fail("BTP CLI target does not match the local profile global account.");
  }

  onProgress("BTP target matched; checking the Cloud Foundry target...");
  const cfTarget = spawnBounded(byName.cf.command, ["target"], { cwd: root });
  if (cfTarget.error || cfTarget.status !== 0) {
    fail(
      "Cloud Foundry target verification failed; refresh browser SSO with cf login --sso.",
    );
  }
  const cfOutput = String(cfTarget.stdout).toLowerCase();
  for (const [label, expected] of [
    ["API endpoint", new URL(btp.cloudFoundry.apiEndpoint).hostname],
    ["organization", btp.cloudFoundry.organization],
    ["space", btp.cloudFoundry.space],
  ]) {
    if (!cfOutput.includes(expected.toLowerCase())) {
      fail(`Cloud Foundry ${label} does not match the local profile.`);
    }
  }

  onProgress("Targets matched; checking the Cloud Foundry MultiApps plugin...");
  const cfPlugins = spawnBounded(byName.cf.command, ["plugins"], { cwd: root });
  if (
    cfPlugins.error ||
    cfPlugins.status !== 0 ||
    !/\bmultiapps\b/i.test(String(cfPlugins.stdout))
  ) {
    fail("Cloud Foundry MultiApps plugin verification failed.");
  }

  onProgress(
    "MultiApps ready; checking Terraform format and provider schema...",
  );
  const terraformArguments = [
    ["-chdir=infrastructure/btp", "fmt", "-check"],
    ["-chdir=infrastructure/btp", "validate", "-no-color"],
  ];
  for (const args of terraformArguments) {
    const result = spawnBounded(byName.terraform.command, args, {
      cwd: root,
      timeout: 30_000,
    });
    if (result.error || result.status !== 0) {
      fail(
        `Terraform ${args[1]} verification failed without changing infrastructure.`,
      );
    }
  }

  onProgress("Terraform checks passed; inspecting the local MTA artifact...");
  const artifact = join(root, "mta_archives", "flowpilot_0.1.3.mtar");
  return {
    tools: tools.map(({ name, detail }) => ({ name, detail })),
    targets: { btp: "matched", cloudFoundry: "matched" },
    multiApps: "present",
    terraform: "format and provider validation passed",
    artifact: existsSync(artifact)
      ? { status: "present", bytes: statSync(artifact).size }
      : { status: "not present; strict build is a later local stage" },
  };
}

function printHelp(write) {
  write(`FlowPilot BTP environment bootstrap (Checkpoint 3A)\n\n`);
  write(`Usage: npm run btp:bootstrap -- [options]\n\n`);
  write(`  --mode dry-run|verify       Default: dry-run\n`);
  write(`  --profile <path>            BTP target profile\n`);
  write(`  --operations-profile <path> Recovery operations profile\n`);
  write(`  --help                      Show this help\n\n`);
  write(
    `Mutation flags such as --apply, --deploy, --secret, and --restore are refused.\n`,
  );
}

export function runBootstrap(argv, io = console, root = repositoryRoot) {
  const options = parseArguments(argv);
  if (options.help) {
    printHelp((value) => io.log(value.trimEnd()));
    return 0;
  }
  const paths = resolveProfilePaths(options, root);
  const btpProfile = readJsonProfile(paths.btp);
  const operationsProfile = readJsonProfile(paths.operations);
  const btp = validateBtpProfile(btpProfile.value);
  const operations = validateOperationsProfile(operationsProfile.value);
  const plan = buildBootstrapPlan(btp, operations);

  io.log("FlowPilot BTP bootstrap");
  io.log(`Mode: ${options.mode}`);
  io.log(
    `BTP profile: ${paths.btp.endsWith(".example.json") ? "example/template" : "local/ignored"}`,
  );
  io.log(
    `Operations profile: ${paths.operations.endsWith(".example.json") ? "example/template" : "local/ignored"}`,
  );
  io.log(
    `Target: ${btp.btp.subaccountName} (${btp.btp.region}) -> ${btp.cloudFoundry.organization}/${btp.cloudFoundry.space}`,
  );
  io.log("");
  plan.forEach((step, index) => {
    io.log(`${index + 1}. ${step.stage} [${step.effect}]`);
    io.log(`   ${step.action}`);
    io.log(`   Gate: ${step.gate}`);
  });
  io.log("");
  io.log(
    "Checkpoint 3A enforcement: APPLY, DEPLOYMENT, SECRET ENTRY, BACKUP, AND RESTORE ARE DISABLED.",
  );

  if (options.mode === "dry-run") {
    io.log(
      "Dry run complete: profile files were read; no external command or platform mutation ran.",
    );
    return 0;
  }

  io.log("Starting bounded read-only verification...");
  const verification = verifyReadOnlyEnvironment(btp, root, (message) =>
    io.log(message),
  );
  verification.tools.forEach((tool) =>
    io.log(`Tool ${tool.name}: ${tool.detail}`),
  );
  io.log("Targets: BTP and Cloud Foundry match the local profile.");
  io.log(`MultiApps plugin: ${verification.multiApps}.`);
  io.log(`Terraform: ${verification.terraform}.`);
  io.log(
    `MTAR: ${verification.artifact.status}${verification.artifact.bytes ? ` (${verification.artifact.bytes} bytes)` : ""}.`,
  );
  io.log(
    "Read-only verification complete: no apply, deploy, secret, backup, or restore ran.",
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    process.exitCode = runBootstrap(process.argv.slice(2));
  } catch (error) {
    console.error(
      `Bootstrap refused: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  }
}
