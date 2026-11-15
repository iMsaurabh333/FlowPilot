import type { ConversationSummary, CurrentUser, FlowPilotApi } from "./api";
import { IntegrationHealth } from "./IntegrationHealth";

export interface HomeViewProps {
  user: CurrentUser;
  conversations: ConversationSummary[];
  onStartTroubleshooting: (prompt?: string) => void;
  onOpenHealth: () => void;
  onResumeConversation: (conversationId: string) => void;
  client: FlowPilotApi;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function HomeView({ user, conversations, onStartTroubleshooting, onOpenHealth, onResumeConversation, client }: HomeViewProps) {
  const firstName = (user.displayName ?? user.subject).trim().split(/\s+/)[0];
  const recentConversations = conversations.slice(0, 3);

  return <main className="home-page" aria-labelledby="home-title">
    <section className="home-hero">
      <p className="section-label">FLOWPILOT WORKSPACE</p>
      <h1 id="home-title">Good to see you, {firstName}.</h1>
      <p>Your operational briefing highlights where attention is most useful right now.</p>
      <div className="home-hero-actions"><button type="button" className="home-primary-action" onClick={() => onStartTroubleshooting()}>Investigate an issue</button></div>
    </section>
    <section className="home-briefing" aria-labelledby="briefing-title">
      <div className="home-section-heading"><div><p className="section-label">TODAY'S OPERATIONS BRIEFING</p><h2 id="briefing-title">What needs your attention</h2></div><span className="home-status"><i aria-hidden="true" />Private tenant active</span></div>
      <div className="home-briefing-grid">
        <section className="home-briefing-panel home-health-panel" aria-label="Integration health summary"><IntegrationHealth client={client} compact showTrend /><button type="button" className="home-text-action" onClick={onOpenHealth}>View Integration Health <span aria-hidden="true">→</span></button></section>
        <section className="home-briefing-panel" aria-labelledby="continue-title"><div className="home-panel-heading"><div><p className="section-label">CONTINUE WORKING</p><h3 id="continue-title">Recent investigations</h3></div><span>{conversations.length} total</span></div>{recentConversations.length ? <ol className="home-conversation-list">{recentConversations.map((conversation) => <li key={conversation.id}><div><strong>{conversation.title}</strong><small>{formatUpdatedAt(conversation.updatedAt)}</small></div><button type="button" onClick={() => onResumeConversation(conversation.id)}>Resume</button></li>)}</ol> : <p className="home-empty-note">No private investigations yet. Start with the issue that is most urgent.</p>}</section>
      </div>
    </section>
    <section className="home-next-checks" aria-labelledby="next-checks-title"><div><p className="section-label">SUGGESTED NEXT CHECKS</p><h2 id="next-checks-title">Start with a focused question</h2></div><div className="home-suggestion-actions"><button type="button" onClick={() => onStartTroubleshooting("Investigate the highest-impact failed integration message and suggest the next checks.")}>Investigate highest-impact failure</button><button type="button" onClick={() => onStartTroubleshooting("Summarize failed integration messages from the last completed hour and identify the most useful next checks.")}>Summarize the last hour</button><button type="button" onClick={() => onStartTroubleshooting("Help me investigate an integration flow. I will provide the flow ID and observed symptom.")}>Investigate an iFlow</button></div></section>
  </main>;
}
