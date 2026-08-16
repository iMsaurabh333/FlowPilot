import { Pool, type PoolConfig } from "pg";
import { parse } from "pg-connection-string";
import { z } from "zod";

const databaseCredentialsSchema = z
  .object({
    uri: z.string().url().optional(),
    url: z.string().url().optional(),
    sslcert: z.string().min(1).optional(),
    sslrootcert: z.string().min(1).optional(),
  })
  .passthrough();

const bindingCredentialsSchema = databaseCredentialsSchema.extend({
  credentials: databaseCredentialsSchema.optional(),
});

const serviceBindingSchema = z.object({
  name: z.string().optional(),
  instance_name: z.string().optional(),
  label: z.string().optional(),
  tags: z.array(z.string()).optional(),
  credentials: bindingCredentialsSchema,
});

export interface DatabaseConfig {
  connectionString: string;
  ssl?: {
    ca: string;
    rejectUnauthorized: true;
  };
}

function databaseConfigFromBindings(vcapServices: string | undefined) {
  if (!vcapServices) {
    return undefined;
  }

  const services = z
    .record(z.string(), z.array(serviceBindingSchema))
    .parse(JSON.parse(vcapServices));
  const bindings = Object.values(services).flat();
  const binding = bindings.find(
    (candidate) =>
      candidate.label === "postgresql-db" ||
      candidate.name === "flowpilot-postgres" ||
      candidate.instance_name === "flowpilot-postgres" ||
      candidate.tags?.includes("postgresql"),
  );
  const credentials = binding?.credentials.credentials ?? binding?.credentials;
  if (!credentials) {
    return undefined;
  }
  const connectionString = credentials?.uri ?? credentials?.url;
  if (!connectionString) {
    return undefined;
  }

  const certificate = credentials.sslrootcert ?? credentials.sslcert;
  return {
    connectionString,
    ...(certificate
      ? { ssl: { ca: certificate, rejectUnauthorized: true as const } }
      : {}),
  } satisfies DatabaseConfig;
}

export function resolveDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const binding = databaseConfigFromBindings(environment.VCAP_SERVICES);
  if (binding) {
    return binding;
  }

  const explicitUrl = environment.DATABASE_URL?.trim();
  if (explicitUrl) {
    const certificate = environment.DATABASE_SSL_ROOT_CERT?.trim();
    return {
      connectionString: explicitUrl,
      ...(certificate
        ? { ssl: { ca: certificate, rejectUnauthorized: true } }
        : {}),
    };
  }

  throw new Error(
    "No PostgreSQL connection is configured through DATABASE_URL or a bound postgresql-db service",
  );
}

export function resolveDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return resolveDatabaseConfig(environment).connectionString;
}

export function createPostgresPool(
  config: DatabaseConfig,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const parsedConnection = parse(config.connectionString) as PoolConfig;
  const maximumConnections = z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .parse(environment.DATABASE_POOL_MAX);

  return new Pool({
    ...parsedConnection,
    application_name: "flowpilot-api",
    max: maximumConnections,
    ...(config.ssl ? { ssl: config.ssl } : {}),
    statement_timeout: 15_000,
  });
}
