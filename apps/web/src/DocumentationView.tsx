const features = [
  ["Home", "Start here for an operational briefing, recent investigations, and shortcuts to the next useful check."],
  ["Health", "Review failed CPI messages by time period, examine affected integration flows, and compare their processing time."],
  ["Assistant chat", "Ask a focused operational question in plain language and keep the investigation in a private conversation."],
  ["Bulk actions", "Prepare and review a set of integration-flow changes before you run or schedule them."],
  ["Reports", "Run, schedule, and export repeatable operational checks when your workspace makes reports available."],
] as const;

export function DocumentationView() {
  return <main className="documentation-page" aria-labelledby="documentation-title">
    <header className="reports-header documentation-intro">
      <p className="section-label">FLOWPILOT GUIDE</p>
      <h1 id="documentation-title">Work with confidence</h1>
      <p>FlowPilot brings the information you need to investigate Cloud Integration operations into one workspace. It helps you find evidence and decide the next step; it does not replace your established operational approval process.</p>
    </header>

    <section className="documentation-section" aria-labelledby="guide-purpose-title">
      <h2 id="guide-purpose-title">What FlowPilot helps you do</h2>
      <p>Use FlowPilot to understand what is happening in your integrations, investigate failed messages, follow an issue across a flow, and prepare a clear next action. Your conversations and investigation history stay private to your signed-in workspace.</p>
    </section>

    <section className="documentation-section" aria-labelledby="guide-features-title">
      <h2 id="guide-features-title">Know the workspace</h2>
      <div className="documentation-grid" aria-label="FlowPilot features">
        {features.map(([title, description]) => <article key={title}><h3>{title}</h3><p>{description}</p></article>)}
      </div>
    </section>

    <section className="documentation-section documentation-workflows" aria-labelledby="guide-how-to-title">
      <h2 id="guide-how-to-title">How to get an answer</h2>
      <div>
        <article><h3>Investigate an issue</h3><ol><li>Open <strong>Assistant chat</strong> or select <strong>Investigate an issue</strong> from Home.</li><li>Describe the symptom and include an integration-flow ID, application message ID, correlation ID, or time period when you have one.</li><li>Read the returned summary and evidence, then use the suggested next checks to narrow the issue.</li></ol><p><strong>Expected outcome:</strong> a focused explanation of the available message-processing evidence and a practical next check—not a guess presented as fact.</p></article>
        <article><h3>Check Health and performance</h3><ol><li>Open <strong>Health</strong> and choose the reporting window that matches the incident.</li><li>Use <strong>Diagnostics</strong> to select an affected flow and review grouped failed application messages.</li><li>Use <strong>Processing time</strong> to identify the flows with the highest average duration in that window.</li></ol><p><strong>Expected outcome:</strong> a prioritized view of failures or slow flows to guide your investigation.</p></article>
        <article><h3>Prepare an operational change</h3><ol><li>Open <strong>Bulk actions</strong> and select the available packages and flows.</li><li>Choose the action and configuration, then review the planned work before proceeding.</li><li>Run it now or schedule it only after it has passed your team’s normal checks.</li></ol><p><strong>Expected outcome:</strong> a reviewed, traceable batch of actions. Confirm the final state in CPI after it runs.</p></article>
      </div>
    </section>

    <section className="documentation-section documentation-two-column" aria-label="Limits and getting help">
      <article><h2>What to keep in mind</h2><ul><li>Results reflect the information available through your approved connections and permissions; missing data is not proof that an event did not occur.</li><li>Health snapshots are refreshed periodically, so very recent activity may not appear immediately.</li><li>Assistant responses help you investigate; validate important conclusions against the source system and your operating procedures.</li><li>Some tools or reports may be unavailable in your environment or role.</li></ul></article>
      <article><h2>When something does not answer your question</h2><ol><li>Check the message IDs, flow name, and time window; broaden the period if the event may be outside it.</li><li>In Assistant chat, ask a narrower follow-up and add the identifier or error text you found.</li><li>Use Health to compare related failures and inspect the grouped error details.</li><li>If data is unavailable or the issue remains unclear, contact your integration support team with the flow name, timestamps, message IDs, error text, and the checks already completed.</li></ol></article>
    </section>
  </main>;
}
