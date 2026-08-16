import type { AuthenticatedUser } from "../types.js";

export interface ConversationRecord {
  id: string;
  threadId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export type RunAcquisition =
  | { status: "acquired"; conversation: ConversationRecord }
  | { status: "busy" }
  | { status: "not_found" };

export interface ConversationRepository {
  create(user: AuthenticatedUser): Promise<ConversationRecord>;
  list(user: AuthenticatedUser): Promise<ConversationRecord[]>;
  findOwned(
    user: AuthenticatedUser,
    conversationId: string,
  ): Promise<ConversationRecord | undefined>;
  acquireRun(
    user: AuthenticatedUser,
    conversationId: string,
    runId: string,
  ): Promise<RunAcquisition>;
  completeRun(
    user: AuthenticatedUser,
    conversationId: string,
    runId: string,
    title: string,
  ): Promise<void>;
  releaseRun(
    user: AuthenticatedUser,
    conversationId: string,
    runId: string,
  ): Promise<void>;
}
