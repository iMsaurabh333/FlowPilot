import { ThemeProvider } from "@ui5/webcomponents-react/ThemeProvider";
import "@ui5/webcomponents/dist/Assets.js";
import "@ui5/webcomponents-fiori/dist/Assets.js";
import { setTheme } from "@ui5/webcomponents-base/dist/config/Theme.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

void setTheme("sap_horizon");

const root = document.getElementById("root");
if (!root) {
  throw new Error("FlowPilot root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
