import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const app = createApp();

app.listen(port, () => {
  console.log(
    JSON.stringify({ level: "info", message: "flowpilot-api started", port }),
  );
});
