import { describe, expect, it } from "vitest";

import {
  resolveDatabaseConfig,
  resolveDatabaseUrl,
} from "../src/db/postgres.js";

const testUrl = "postgresql://flowpilot:test@database.example:5432/flowpilot";

describe("PostgreSQL configuration", () => {
  it("prefers an explicit local database URL", () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: testUrl,
      }),
    ).toBe(testUrl);
  });

  it("reads the direct Cloud Foundry credential shape", () => {
    expect(
      resolveDatabaseUrl({
        VCAP_SERVICES: JSON.stringify({
          "postgresql-db": [
            {
              label: "postgresql-db",
              credentials: { uri: testUrl },
            },
          ],
        }),
      }),
    ).toBe(testUrl);
  });

  it("reads the nested credential shape returned by the BTP trial broker", () => {
    const certificate =
      "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----";
    expect(
      resolveDatabaseConfig({
        VCAP_SERVICES: JSON.stringify({
          "postgresql-db": [
            {
              label: "postgresql-db",
              credentials: {
                credentials: { uri: testUrl, sslrootcert: certificate },
              },
            },
          ],
        }),
      }),
    ).toEqual({
      connectionString: testUrl,
      ssl: { ca: certificate, rejectUnauthorized: true },
    });
  });

  it("prefers the certificate-bearing CF binding over a buildpack URL", () => {
    const certificate = "platform-ca";
    expect(
      resolveDatabaseConfig({
        DATABASE_URL: "postgresql://buildpack:url@database.example/fallback",
        VCAP_SERVICES: JSON.stringify({
          "postgresql-db": [
            {
              label: "postgresql-db",
              credentials: { uri: testUrl, sslcert: certificate },
            },
          ],
        }),
      }),
    ).toEqual({
      connectionString: testUrl,
      ssl: { ca: certificate, rejectUnauthorized: true },
    });
  });
});
