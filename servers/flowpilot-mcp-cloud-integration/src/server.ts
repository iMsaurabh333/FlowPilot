import { createConfiguredAuthentication } from "./auth.js";
import { createMcpApp } from "./app.js";
import { createCloudIntegrationContentMcpServer } from "./content.js";
import { loadMcpServerConfig } from "./config.js";
import { MCP_SERVER_NAME } from "./constants.js";

async function main(): Promise<void> {
  const config = loadMcpServerConfig();
  const authentication = createConfiguredAuthentication(config.authMode);
  const contentToolset = process.env.MCP_TOOLSET === "content";
  const runtime = createMcpApp({
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
    authorizationServerUrl: authentication.authorizationServerUrl,
    host: config.host,
    resourceServerUrl: config.publicUrl,
    verifier: authentication.verifier,
    ...(contentToolset
      ? { serverName: "flowpilot-cloud-integration-content" }
      : {}),
    ...(contentToolset
      ? { createServer: createCloudIntegrationContentMcpServer }
      : {}),
  });

  const server = runtime.app.listen(config.port, config.host, () => {
    console.log(
      JSON.stringify({
        level: "info",
        message: `${contentToolset ? "flowpilot-cloud-integration-content" : MCP_SERVER_NAME} started`,
        host: config.host,
        port: config.port,
      }),
    );
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    server.close(async () => {
      await runtime.close();
      process.exitCode = 0;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: `${MCP_SERVER_NAME} failed to start`,
      errorType: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
});
