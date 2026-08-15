export interface CurrentUser {
  subject: string;
  tenantId: string;
  displayName?: string;
  scopes: string[];
}

export async function loadCurrentUser(
  fetcher: typeof fetch = fetch,
): Promise<CurrentUser> {
  const response = await fetcher("/api/me", {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Unable to load the current user (${response.status})`);
  }

  return (await response.json()) as CurrentUser;
}
