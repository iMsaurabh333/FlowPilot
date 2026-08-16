# ADR 0004: Groq-First Provider-Neutral Model Runtime

- Status: Accepted
- Date: 2026-08-16

## Context

FlowPilot needs a LangGraph-based chat runtime that starts with Groq but can switch to OpenAI, Anthropic, or another reviewed provider without changing the graph or API code. Provider credentials must remain outside the repository and browser.

## Decision

Create a reusable model package with a provider-neutral factory that returns the LangChain chat-model interface consumed by LangGraph.

The initial configuration defaults are:

```text
MODEL_PROVIDER=groq
MODEL_NAME=llama-3.3-70b-versatile
MODEL_TEMPERATURE=0
MODEL_MAX_OUTPUT_TOKENS=1024
MODEL_TIMEOUT_MS=30000
MODEL_MAX_RETRIES=2
```

`llama-3.3-70b-versatile` is a Groq production model at the time of this decision. The model identifier remains configuration because provider model catalogs and deprecation schedules change.

The initial package will support installed adapters for Groq, OpenAI, and Anthropic behind the same factory. Groq is the only provider required for the first deployed smoke test. Switching among installed adapters changes server-side configuration and credentials, not graph code. Adding a provider whose integration package is not installed still requires a reviewed dependency and adapter change.

Only the backend selects the provider and model. Browser requests cannot supply a provider, model, base URL, or API key. The graph receives an injected model interface and contains no provider-specific branches.

Use SAP Credential Store for deployed third-party API credentials. Local development may read a provider key from an ignored local environment file. Automated tests use a fake model and never call a billable provider.

## Consequences

- Groq is the default while the LangGraph component remains reusable.
- Model changes can be tested independently from graph and tool logic.
- Provider-specific capabilities must be normalized or explicitly declared; the application must not assume that every model supports identical tool-calling or structured-output behavior.
- Production-model status and deprecation notices must be checked before releases.
- Timeouts, retries, token limits, rate limits, and usage metadata are enforced outside the UI.

## References

- [LangChain JavaScript ChatGroq integration](https://docs.langchain.com/oss/javascript/integrations/chat/groq)
- [LangChain JavaScript model interface](https://docs.langchain.com/oss/javascript/langchain/models)
- [Groq supported production models](https://console.groq.com/docs/models)
- [Groq model deprecation guidance](https://console.groq.com/docs/deprecations)
