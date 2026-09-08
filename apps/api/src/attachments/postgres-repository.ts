import type { Pool, PoolClient } from "pg";

import { quoteIdentifier } from "../db/migrations.js";
import type { AuthenticatedUser } from "../types.js";
import type {
  AttachmentRecord,
  AttachmentRepository,
  StoredAttachment,
} from "./service.js";

interface AttachmentRow {
  id: string;
  conversation_id: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  payload?: Buffer;
  created_at: Date;
  expires_at: Date;
}

function record(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class PostgresAttachmentRepository implements AttachmentRepository {
  readonly #pool: Pool;
  readonly #attachments: string;
  readonly #conversations: string;

  constructor(pool: Pool, schemaName = "flowpilot_app") {
    this.#pool = pool;
    const schema = quoteIdentifier(schemaName);
    this.#attachments = `${schema}.conversation_attachments`;
    this.#conversations = `${schema}.conversations`;
  }

  async #withIdentity<T>(
    user: AuthenticatedUser,
    operation: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('flowpilot.tenant_id', $1, true), set_config('flowpilot.subject_id', $2, true)",
        [user.tenantId, user.subject],
      );
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async create(user: AuthenticatedUser, attachment: StoredAttachment) {
    return this.#withIdentity(user, async (client) => {
      const owner = await client.query(
        `SELECT id FROM ${this.#conversations} WHERE id = $1 AND active_run_id IS NULL`,
        [attachment.conversationId],
      );
      if (!owner.rowCount) return false;
      await client.query(
        `INSERT INTO ${this.#attachments} (
          id, conversation_id, tenant_id, subject_id, file_name, content_type,
          byte_size, payload, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          attachment.id,
          attachment.conversationId,
          user.tenantId,
          user.subject,
          attachment.fileName,
          attachment.contentType,
          attachment.byteSize,
          attachment.content,
          attachment.createdAt,
          attachment.expiresAt,
        ],
      );
      return true;
    });
  }

  async list(user: AuthenticatedUser, conversationId: string) {
    return this.#withIdentity(user, async (client) => {
      const owner = await client.query(
        `SELECT id FROM ${this.#conversations} WHERE id = $1`,
        [conversationId],
      );
      if (!owner.rowCount) return undefined;
      const result = await client.query<AttachmentRow>(
        `SELECT id, conversation_id, file_name, content_type, byte_size, created_at, expires_at
           FROM ${this.#attachments} WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC`,
        [conversationId],
      );
      return result.rows.map(record);
    });
  }

  async find(user: AuthenticatedUser, attachmentId: string) {
    return this.#withIdentity(user, async (client) => {
      const result = await client.query<AttachmentRow>(
        `SELECT id, conversation_id, file_name, content_type, byte_size, payload, created_at, expires_at
           FROM ${this.#attachments} WHERE id = $1`,
        [attachmentId],
      );
      const row = result.rows[0];
      return row?.payload
        ? { ...record(row), content: row.payload }
        : undefined;
    });
  }

  async delete(user: AuthenticatedUser, attachmentId: string) {
    return this.#withIdentity(user, async (client) =>
      Boolean(
        (
          await client.query(
            `DELETE FROM ${this.#attachments} WHERE id = $1 RETURNING id`,
            [attachmentId],
          )
        ).rowCount,
      ),
    );
  }

  async purgeExpired(user: AuthenticatedUser, conversationId: string) {
    await this.#withIdentity(user, async (client) => {
      await client.query(
        `DELETE FROM ${this.#attachments} WHERE conversation_id = $1 AND expires_at <= now()`,
        [conversationId],
      );
    });
  }
}
