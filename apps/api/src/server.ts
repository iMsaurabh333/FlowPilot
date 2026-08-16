import { createRuntime } from "./runtime.js";

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
      errorType: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
});
