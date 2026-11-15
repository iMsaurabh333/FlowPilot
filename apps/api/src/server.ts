import { createRuntime } from "./runtime.js";

function safeStartupFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown startup failure";
  const cause = error instanceof Error ? error.cause : undefined;
  const causeType = cause instanceof Error ? cause.name : undefined;
  return {
    errorType: error instanceof Error ? error.name : "UnknownError",
    errorMessage: message
      .replace(/(?:postgres(?:ql)?:\/\/|https?:\/\/)[^\s@/]+@[^\s/]+/giu, "[redacted-url]")
      .replace(/\b(password|secret|token|client_secret)=\S+/giu, "$1=[redacted]")
      .slice(0, 500),
    ...(causeType ? { causeType } : {}),
  };
}

async function main() {
  const port = Number.parseInt(process.env.PORT ?? "4000", 10);
  const runtime = await createRuntime();
  const server = runtime.app.listen(port, () => {
    console.log(
      JSON.stringify({ level: "info", message: "flowpilot-api started", port }),
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
      message: "flowpilot-api failed to start",
      ...safeStartupFailure(error),
    }),
  );
  process.exitCode = 1;
});
