import type { Pool, PoolClient } from "pg";

const schemaNamePattern = /^[a-z_][a-z0-9_]*$/;

export function safeSchemaName(value: string) {
  if (!schemaNamePattern.test(value)) {
    throw new Error(`Invalid PostgreSQL schema name: ${value}`);
  }
  return value;
}

export function quoteIdentifier(value: string) {
  return `"${safeSchemaName(value)}"`;
}

function migrations(schemaName: string) {
  const schema = quoteIdentifier(schemaName);
  return [
    {
      version: 1,
      sql: `
        CREATE TABLE ${schema}.conversations (
          id uuid PRIMARY KEY,
          thread_id uuid NOT NULL UNIQUE,
          tenant_id text NOT NULL,
          subject_id text NOT NULL,
          title text NOT NULL,
          active_run_id uuid,
          run_started_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT conversations_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
          CONSTRAINT conversations_run_state CHECK (
            (active_run_id IS NULL AND run_started_at IS NULL) OR
            (active_run_id IS NOT NULL AND run_started_at IS NOT NULL)
          )
        );

        CREATE INDEX conversations_owner_updated_idx
          ON ${schema}.conversations (tenant_id, subject_id, updated_at DESC);

        ALTER TABLE ${schema}.conversations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${schema}.conversations FORCE ROW LEVEL SECURITY;

        CREATE POLICY conversations_owner_policy
          ON ${schema}.conversations
          USING (
            tenant_id = current_setting('flowpilot.tenant_id', true) AND
            subject_id = current_setting('flowpilot.subject_id', true)
          )
          WITH CHECK (
            tenant_id = current_setting('flowpilot.tenant_id', true) AND
            subject_id = current_setting('flowpilot.subject_id', true)
          );
      `,
    },
  ] as const;
}

async function withMigrationLock<T>(
  client: PoolClient,
  operation: () => Promise<T>,
) {
  const lockName = "flowpilot-schema-migrations";
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
  try {
    return await operation();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
  }
}

export async function runMigrations(pool: Pool, schemaName = "flowpilot_app") {
  const schema = quoteIdentifier(schemaName);
  const client = await pool.connect();
  try {
    await withMigrationLock(client, async () => {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      for (const migration of migrations(schemaName)) {
        const existing = await client.query<{ version: number }>(
          `SELECT version FROM ${schema}.schema_migrations WHERE version = $1`,
          [migration.version],
        );
        if (existing.rowCount) {
          continue;
        }

        await client.query("BEGIN");
        try {
          await client.query(migration.sql);
          await client.query(
            `INSERT INTO ${schema}.schema_migrations (version) VALUES ($1)`,
            [migration.version],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    });
  } finally {
    client.release();
  }
}
