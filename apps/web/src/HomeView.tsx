import type { ReactNode } from "react";
import type { CurrentUser } from "./api";

type HomeIconName = "chat" | "bulk" | "reports";

function HomeActionIcon({ icon }: { icon: HomeIconName }) {
  const paths: Record<HomeIconName, ReactNode> = {
    chat: <path d="M20 11.4a7.6 7.6 0 0 1-8 7.5 8.8 8.8 0 0 1-3.6-.8L4 20l1.4-4A7.2 7.2 0 0 1 4 11.4 7.6 7.6 0 0 1 12 4a7.6 7.6 0 0 1 8 7.4ZM8.5 11.5h.1m3.3 0h.1m3.3 0h.1" />,
    bulk: <path d="M5 5.5h11a2 2 0 0 1 2 2V19H7a2 2 0 0 1-2-2V5.5Zm0 0h11v11.5H7a2 2 0 0 0-2 2V5.5ZM8 9h5m-5 3h5m-5 3h4M18 8h1a1 1 0 0 1 1 1v10H9" />,
    reports: <path d="M7 3.5h8l3 3V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Zm7.5 0V7H18M9 11h6M9 14h6M9 17h4" />,
  };
  return <span className="home-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">{paths[icon]}</svg></span>;
}

export interface HomeViewProps {
  user: CurrentUser;
  conversationCount: number;
  onOpenChat: () => void;
  onOpenReports: () => void;
  onOpenBulkActions: () => void;
}

export function HomeView({
  user,
  conversationCount,
  onOpenChat,
  onOpenReports,
  onOpenBulkActions,
}: HomeViewProps) {
  const firstName = (user.displayName ?? user.subject).trim().split(/\s+/)[0];

  return (
    <main className="home-page" aria-labelledby="home-title">
      <section className="home-hero">
        <p className="section-label">FLOWPILOT WORKSPACE</p>
        <h1 id="home-title">Good to see you, {firstName}.</h1>
        <p>
          Investigate integration issues, coordinate flow changes, and keep
          operational reporting in one focused workspace.
        </p>
        <div className="home-hero-actions">
          <button type="button" className="home-primary-action" onClick={onOpenChat}>
            Start troubleshooting
          </button>
          <button type="button" className="home-secondary-action" onClick={onOpenReports}>
            Open reports
          </button>
        </div>
      </section>

      <section className="home-section" aria-labelledby="workspace-title">
        <div className="home-section-heading">
          <div>
            <p className="section-label">WORKSPACE</p>
            <h2 id="workspace-title">Choose where to begin</h2>
          </div>
          <span className="home-status"><i aria-hidden="true" />Private tenant active</span>
        </div>
        <div className="home-action-grid">
          <button type="button" className="home-action-card" onClick={onOpenChat}>
            <HomeActionIcon icon="chat" />
            <span><strong>Assistant chat</strong><small>Investigate messages, transactions, and integration flows.</small></span>
            <b aria-hidden="true">→</b>
          </button>
          <button type="button" className="home-action-card" onClick={onOpenBulkActions}>
            <HomeActionIcon icon="bulk" />
            <span><strong>Bulk actions</strong><small>Deploy and configure iFlows with a controlled workflow.</small></span>
            <b aria-hidden="true">→</b>
          </button>
          <button type="button" className="home-action-card" onClick={onOpenReports}>
            <HomeActionIcon icon="reports" />
            <span><strong>Reports</strong><small>Reconcile data and prepare export-ready operational reports.</small></span>
            <b aria-hidden="true">→</b>
          </button>
        </div>
      </section>

      <section className="home-activity" aria-labelledby="activity-title">
        <div>
          <p className="section-label">YOUR ACTIVITY</p>
          <h2 id="activity-title">Private conversations</h2>
        </div>
        <p><strong>{conversationCount}</strong> {conversationCount === 1 ? "conversation" : "conversations"} available in your workspace.</p>
        <button type="button" className="home-inline-action" onClick={onOpenChat}>View conversations →</button>
      </section>
    </main>
  );
}
