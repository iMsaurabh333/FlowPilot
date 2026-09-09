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
    {
      version: 2,
      sql: `
        CREATE TABLE ${schema}.mcp_servers (
          server_id text PRIMARY KEY,
          profile_id text NOT NULL,
          display_name text NOT NULL,
          endpoint_url text NOT NULL,
          mcp_path text NOT NULL,
          external_port integer,
          auth_profile_ref text NOT NULL,
          allowed_tool_names text[] NOT NULL,
          required_scopes text[] NOT NULL,
          enabled boolean NOT NULL DEFAULT false,
          health_state text NOT NULL DEFAULT 'never_checked',
          last_checked_at timestamptz,
          latency_ms integer,
          protocol_version text,
          discovered_tool_count integer,
          last_error_category text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT mcp_servers_id_length CHECK (char_length(server_id) BETWEEN 1 AND 63),
          CONSTRAINT mcp_servers_name_length CHECK (char_length(display_name) BETWEEN 1 AND 120),
          CONSTRAINT mcp_servers_port_range CHECK (external_port IS NULL OR external_port BETWEEN 1 AND 65535),
          CONSTRAINT mcp_servers_health_state CHECK (health_state IN ('never_checked', 'healthy', 'unhealthy', 'stale')),
          CONSTRAINT mcp_servers_latency_range CHECK (latency_ms IS NULL OR latency_ms >= 0),
          CONSTRAINT mcp_servers_tool_count_range CHECK (discovered_tool_count IS NULL OR discovered_tool_count >= 0)
        );

        CREATE INDEX mcp_servers_enabled_health_idx
          ON ${schema}.mcp_servers (enabled, health_state, updated_at DESC);

        CREATE UNIQUE INDEX mcp_servers_external_port_unique_idx
          ON ${schema}.mcp_servers (external_port)
          WHERE external_port IS NOT NULL;

        ALTER TABLE ${schema}.mcp_servers ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${schema}.mcp_servers FORCE ROW LEVEL SECURITY;

        CREATE POLICY mcp_servers_admin_policy
          ON ${schema}.mcp_servers
          USING (current_setting('flowpilot.is_admin', true) = 'true')
          WITH CHECK (current_setting('flowpilot.is_admin', true) = 'true');
      `,
    },
    {
      version: 3,
      sql: `
        CREATE TABLE ${schema}.conversation_policy (
          singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
          max_conversations_per_user integer NOT NULL DEFAULT 50,
          max_retained_turns integer NOT NULL DEFAULT 40,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT conversation_policy_conversation_limit CHECK (max_conversations_per_user BETWEEN 1 AND 1000),
          CONSTRAINT conversation_policy_turn_limit CHECK (max_retained_turns BETWEEN 2 AND 500)
        );

        INSERT INTO ${schema}.conversation_policy (singleton)
        VALUES (true)
        ON CONFLICT (singleton) DO NOTHING;

        ALTER TABLE ${schema}.conversation_policy ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${schema}.conversation_policy FORCE ROW LEVEL SECURITY;

        CREATE POLICY conversation_policy_admin_policy
          ON ${schema}.conversation_policy
          USING (current_setting('flowpilot.is_admin', true) = 'true')
          WITH CHECK (current_setting('flowpilot.is_admin', true) = 'true');
      `,
    },
    {
      version: 4,
      sql: `
        CREATE TABLE ${schema}.report_jobs (
          id uuid PRIMARY KEY,
          tenant_id text NOT NULL,
          subject_id text NOT NULL,
          title text NOT NULL,
          report_prompt text NOT NULL,
          scheduled_for timestamptz NOT NULL,
          recurrence_rule text,
          status text NOT NULL DEFAULT 'scheduled',
          active_run_id uuid,
          attempt_count integer NOT NULL DEFAULT 0,
          final_report_html text,
          error_log text,
          started_at timestamptz,
          completed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT report_jobs_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
          CONSTRAINT report_jobs_prompt_length CHECK (char_length(report_prompt) BETWEEN 1 AND 12000),
          CONSTRAINT report_jobs_status CHECK (status IN ('scheduled', 'running', 'succeeded', 'attention', 'failed')),
          CONSTRAINT report_jobs_attempt_count CHECK (attempt_count BETWEEN 0 AND 3),
          CONSTRAINT report_jobs_run_state CHECK (
            (status = 'running' AND active_run_id IS NOT NULL AND started_at IS NOT NULL) OR
            (status <> 'running' AND active_run_id IS NULL)
          )
        );

        CREATE INDEX report_jobs_owner_schedule_idx
          ON ${schema}.report_jobs (tenant_id, subject_id, scheduled_for ASC, created_at DESC);

        ALTER TABLE ${schema}.report_jobs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${schema}.report_jobs FORCE ROW LEVEL SECURITY;

        CREATE POLICY report_jobs_owner_policy
          ON ${schema}.report_jobs
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
    {
      version: 5,
      sql: `
        ALTER POLICY report_jobs_owner_policy ON ${schema}.report_jobs
          USING (
            current_setting('flowpilot.scheduler', true) = 'true' OR
            (tenant_id = current_setting('flowpilot.tenant_id', true) AND subject_id = current_setting('flowpilot.subject_id', true))
          )
          WITH CHECK (
            current_setting('flowpilot.scheduler', true) = 'true' OR
            (tenant_id = current_setting('flowpilot.tenant_id', true) AND subject_id = current_setting('flowpilot.subject_id', true))
          );
      `,
    },
    {
      version: 6,
      sql: `
        CREATE TABLE ${schema}.report_action_plans (
          id uuid PRIMARY KEY,
          tenant_id text NOT NULL,
          subject_id text NOT NULL,
          source_document text NOT NULL,
          plan_text text NOT NULL,
          revision integer NOT NULL DEFAULT 1,
          status text NOT NULL DEFAULT 'draft',
          approved_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT report_action_plans_status CHECK (status IN ('draft', 'approved')),
          CONSTRAINT report_action_plans_revision CHECK (revision >= 1),
          CONSTRAINT report_action_plans_approval CHECK ((status = 'approved' AND approved_at IS NOT NULL) OR (status = 'draft' AND approved_at IS NULL))
        );
        CREATE INDEX report_action_plans_owner_updated_idx ON ${schema}.report_action_plans (tenant_id, subject_id, updated_at DESC);
        ALTER TABLE ${schema}.report_action_plans ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${schema}.report_action_plans FORCE ROW LEVEL SECURITY;
        CREATE POLICY report_action_plans_owner_policy ON ${schema}.report_action_plans
          USING (tenant_id = current_setting('flowpilot.tenant_id', true) AND subject_id = current_setting('flowpilot.subject_id', true))
          WITH CHECK (tenant_id = current_setting('flowpilot.tenant_id', true) AND subject_id = current_setting('flowpilot.subject_id', true));
      `,
    },
    {
      version: 7,
      sql: `ALTER TABLE ${schema}.report_action_plans ADD COLUMN steps jsonb NOT NULL DEFAULT '[]'::jsonb;`,
    },
    {
      version: 8,
      sql: `
        ALTER TABLE ${schema}.report_action_plans
          ADD COLUMN execution_status text,
          ADD COLUMN final_report_html text,
          ADD COLUMN error_log text,
          ADD COLUMN executed_at timestamptz,
          ADD CONSTRAINT report_action_plans_execution_status CHECK (execution_status IS NULL OR execution_status IN ('succeeded', 'attention'));
      `,
    },
    {
      version: 9,
      sql: `ALTER TABLE ${schema}.report_jobs ADD COLUMN action_plan_id uuid REFERENCES ${schema}.report_action_plans(id) ON DELETE RESTRICT;`,
    },
    {
      version: 10,
      sql: `ALTER TABLE ${schema}.report_jobs ADD COLUMN last_run_status text CHECK (last_run_status IS NULL OR last_run_status IN ('succeeded', 'attention', 'failed'));`,
    },
    {
      version: 11,
      sql: `ALTER TABLE ${schema}.report_jobs ADD COLUMN source_tool_names text[] NOT NULL DEFAULT '{}';`,
    },
    {
      version: 12,
      sql: `
        CREATE TABLE ${schema}.report_job_runs (
          id uuid PRIMARY KEY, report_job_id uuid NOT NULL REFERENCES ${schema}.report_jobs(id) ON DELETE CASCADE,
          tenant_id text NOT NULL, subject_id text NOT NULL, status text NOT NULL,
          attempt_count integer NOT NULL, final_report_html text, error_log text,
          started_at timestamptz, completed_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX report_job_runs_owner_completed_idx ON ${schema}.report_job_runs (tenant_id, subject_id, completed_at DESC);
        ALTER TABLE ${schema}.report_job_runs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${schema}.report_job_runs FORCE ROW LEVEL SECURITY;
        CREATE POLICY report_job_runs_owner_policy ON ${schema}.report_job_runs
          USING (tenant_id = current_setting('flowpilot.tenant_id', true) AND subject_id = current_setting('flowpilot.subject_id', true))
          WITH CHECK (tenant_id = current_setting('flowpilot.tenant_id', true) AND subject_id = current_setting('flowpilot.subject_id', true));
      `,
    },
    {
      version: 13,
      sql: `ALTER TABLE ${schema}.report_jobs ADD COLUMN scheduler_job_id text;`,
    },
    {
      version: 14,
      sql: `ALTER TABLE ${schema}.report_jobs ADD COLUMN schedule_active boolean NOT NULL DEFAULT true;`,
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
