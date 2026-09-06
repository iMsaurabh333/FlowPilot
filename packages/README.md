# Reusable Packages

- `agent-core`: Provider-neutral LangGraph conversation workflow, token-budgeted context selection, durable extractive summaries, and content-free model telemetry.
- `model-adapters`: Server-configured Groq, OpenAI, and Anthropic adapters behind one LangChain chat-model contract.

The default OpenAI model is `gpt-5.6-terra`; FlowPilot continues to default to Groq for the current milestone. Provider-specific reasoning and verbosity settings are applied only where the adapter supports them.

Destination, MCP client, MCP server, and shared-contract packages will be introduced only when their first production use case is implemented.
