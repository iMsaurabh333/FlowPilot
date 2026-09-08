import { createConfiguredAuthentication } from "./auth.js";
import { createMcpApp } from "./app.js";
import { loadMcpServerConfig } from "./config.js";
import { MCP_SERVER_NAME } from "./constants.js";
import { MCP_CONTENT_INVOKE_SCOPE, MCP_INVOKE_SCOPE } from "./constants.js";

async function main(): Promise<void> {
  const config = loadMcpServerConfig();
  const authentication = createConfiguredAuthentication(config.authMode, process.env, config.mode === "content" ? MCP_CONTENT_INVOKE_SCOPE : MCP_INVOKE_SCOPE);
  const runtime = createMcpApp({
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
    authorizationServerUrl: authentication.authorizationServerUrl,
    host: config.host,
    mode: config.mode,
    resourceServerUrl: config.publicUrl,
    verifier: authentication.verifier,
  });

  const server = runtime.app.listen(config.port, config.host, () => {
    console.log(
      JSON.stringify({
        level: "info",
        message: `${MCP_SERVER_NAME} started`,
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
