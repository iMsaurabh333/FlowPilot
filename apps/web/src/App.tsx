import { useEffect, useState } from "react";

import { loadCurrentUser, type CurrentUser } from "./api";
import "./styles.css";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; user: CurrentUser }
  | { status: "error"; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    void loadCurrentUser()
      .then((user) => setState({ status: "ready", user }))
      .catch((error: unknown) =>
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Unexpected error",
        }),
      );
  }, []);

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="flowpilot-title">
        <p className="eyebrow">Operational intelligence</p>
        <h1 id="flowpilot-title">FlowPilot</h1>
        <p className="summary">
          A secure assistant for troubleshooting and monitoring transactions
          across SAP and connected systems.
        </p>

        <div className="status-card" aria-live="polite">
          {state.status === "loading" && <p>Verifying your BTP session…</p>}
          {state.status === "error" && (
            <div>
              <strong>Session verification failed</strong>
              <p>{state.message}</p>
            </div>
          )}
          {state.status === "ready" && (
            <div>
              <span className="status-dot" aria-hidden="true" />
              <strong>Authenticated</strong>
              <p>
                Welcome, {state.user.displayName ?? state.user.subject}. Your
                session is isolated from other FlowPilot users.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
