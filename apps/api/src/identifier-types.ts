import type { Pool } from "pg";

import type { AuthenticatedUser } from "./types.js";
import { quoteIdentifier } from "./db/migrations.js";

export type IdentifierTypeStatus = "Draft" | "Active" | "Retired";

export interface IdentifierTypeDefinition {
  id: string;
  systemId: string;
  compositeKey: string;
  status: IdentifierTypeStatus;
  version: number;
  retrieval: {
    serverId: string;
    toolName: string;
    parameters: Record<string, string>;
    headers: Record<string, string>;
    requestBody: string;
    requestFormat: "json" | "xml" | "none";
    responseExtractionPath: string;
    expectedField: string;
    expectedValue: string;
    sampleValue?: string;
  };
  [key: string]: unknown;
}

interface IdentifierTypeRow {
  definition: IdentifierTypeDefinition;
}

export class PostgresIdentifierTypeService {
  readonly #pool: Pool;
  readonly #table: string;

  constructor(pool: Pool, schemaName = "flowpilot_app") {
    this.#pool = pool;
    this.#table = `${quoteIdentifier(schemaName)}.identifier_types`;
  }

  async list(user: AuthenticatedUser): Promise<IdentifierTypeDefinition[]> {
    const result = await this.#pool.query<IdentifierTypeRow>(
      `SELECT definition FROM ${this.#table} WHERE tenant_id = $1 ORDER BY definition->>'systemName', definition->>'friendlyName'`,
      [user.tenantId],
    );
    return result.rows.map((row) => row.definition);
  }

  async save(
    user: AuthenticatedUser,
    input: IdentifierTypeDefinition,
  ): Promise<IdentifierTypeDefinition> {
    const result = await this.#pool.query<IdentifierTypeRow>(
      `INSERT INTO ${this.#table} (tenant_id, id, system_id, composite_key, status, version, definition)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         system_id = EXCLUDED.system_id,
         composite_key = EXCLUDED.composite_key,
         status = EXCLUDED.status,
         version = EXCLUDED.version,
         definition = EXCLUDED.definition,
         updated_at = now()
       RETURNING definition`,
      [
        user.tenantId,
        input.id,
        input.systemId,
        input.compositeKey,
        input.status,
        input.version,
        JSON.stringify(input),
      ],
    );
    return result.rows[0]!.definition;
  }

  async setStatus(
    user: AuthenticatedUser,
    id: string,
    status: IdentifierTypeStatus,
  ): Promise<IdentifierTypeDefinition | undefined> {
    const result = await this.#pool.query<IdentifierTypeRow>(
      `UPDATE ${this.#table}
          SET status = $3,
              version = version + 1,
              definition = jsonb_set(
                jsonb_set(definition, '{status}', to_jsonb($3::text), true),
                '{version}', to_jsonb(version + 1), true
              ),
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING definition`,
      [user.tenantId, id, status],
    );
    return result.rows[0]?.definition;
  }
}
