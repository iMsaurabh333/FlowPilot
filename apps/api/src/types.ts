export interface AuthenticatedUser {
  subject: string;
  tenantId: string;
  displayName?: string;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      flowpilotUser?: AuthenticatedUser;
    }
  }
}
