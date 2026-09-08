import { randomUUID } from "node:crypto";

import type { AuthenticatedUser } from "../types.js";
import { attachmentContext } from "./extractor.js";

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_RETENTION_DAYS = 30;

const allowedContentTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "text/csv",
  "text/plain",
]);

export interface AttachmentRecord {
  id: string;
  conversationId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface StoredAttachment extends AttachmentRecord {
  content: Buffer;
}

export interface AttachmentRepository {
  create(
    user: AuthenticatedUser,
    attachment: StoredAttachment,
  ): Promise<boolean>;
  list(
    user: AuthenticatedUser,
    conversationId: string,
  ): Promise<AttachmentRecord[] | undefined>;
  find(
    user: AuthenticatedUser,
    attachmentId: string,
  ): Promise<StoredAttachment | undefined>;
  delete(user: AuthenticatedUser, attachmentId: string): Promise<boolean>;
  purgeExpired(user: AuthenticatedUser, conversationId: string): Promise<void>;
}

export class AttachmentNotFoundError extends Error {
  constructor() {
    super("Attachment not found");
    this.name = "AttachmentNotFoundError";
  }
}

export class AttachmentValidationError extends Error {
  constructor() {
    super("Attachment is not an approved file type or size");
    this.name = "AttachmentValidationError";
  }
}

function safeFileName(value: string) {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 120 ||
    /[\\/\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new AttachmentValidationError();
  }
  return normalized;
}

function safeContentType(value: string) {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalized || !allowedContentTypes.has(normalized)) {
    throw new AttachmentValidationError();
  }
  return normalized;
}

export function attachmentSummary(attachment: AttachmentRecord) {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
    createdAt: attachment.createdAt.toISOString(),
    expiresAt: attachment.expiresAt.toISOString(),
  };
}

export class AttachmentService {
  readonly #repository: AttachmentRepository;
  readonly #now: () => Date;

  constructor(
    repository: AttachmentRepository,
    now: () => Date = () => new Date(),
  ) {
    this.#repository = repository;
    this.#now = now;
  }

  async create(
    user: AuthenticatedUser,
    conversationId: string,
    input: { fileName: string; contentType: string; content: Buffer },
  ) {
    const fileName = safeFileName(input.fileName);
    const contentType = safeContentType(input.contentType);
    if (
      input.content.length === 0 ||
      input.content.length > ATTACHMENT_MAX_BYTES
    ) {
      throw new AttachmentValidationError();
    }
    const createdAt = this.#now();
    const expiresAt = new Date(
      createdAt.getTime() + ATTACHMENT_RETENTION_DAYS * 86_400_000,
    );
    const attachment: StoredAttachment = {
      id: randomUUID(),
      conversationId,
      fileName,
      contentType,
      byteSize: input.content.length,
      content: input.content,
      createdAt,
      expiresAt,
    };
    if (!(await this.#repository.create(user, attachment))) {
      throw new AttachmentNotFoundError();
    }
    return attachmentSummary(attachment);
  }

  async list(user: AuthenticatedUser, conversationId: string) {
    await this.#repository.purgeExpired(user, conversationId);
    const attachments = await this.#repository.list(user, conversationId);
    if (!attachments) throw new AttachmentNotFoundError();
    return attachments.map(attachmentSummary);
  }

  async download(user: AuthenticatedUser, attachmentId: string) {
    const attachment = await this.#repository.find(user, attachmentId);
    if (
      !attachment ||
      attachment.expiresAt.getTime() <= this.#now().getTime()
    ) {
      if (attachment) await this.#repository.delete(user, attachmentId);
      throw new AttachmentNotFoundError();
    }
    return attachment;
  }

  async delete(user: AuthenticatedUser, attachmentId: string) {
    if (!(await this.#repository.delete(user, attachmentId))) {
      throw new AttachmentNotFoundError();
    }
  }

  async contextForPrompt(user: AuthenticatedUser, attachmentIds: string[]) {
    const uniqueIds = [...new Set(attachmentIds)];
    if (uniqueIds.length !== attachmentIds.length || uniqueIds.length > 3) {
      throw new AttachmentValidationError();
    }
    const attachments = await Promise.all(
      uniqueIds.map((attachmentId) => this.download(user, attachmentId)),
    );
    return attachmentContext(attachments);
  }
}
