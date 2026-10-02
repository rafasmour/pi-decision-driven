# Decision-Driven architecture

**Decision-Driven** is a fork of [Pi](https://github.com/earendil-works/pi) that adds a decision-model harness to the agent loop. The chat model still drives the session; classifiers (especially [Jev](https://typesafe.ai/jev)) answer structured questions so the harness can act without guessing.

This document is a high-level map of Wave 1 on `main`. npm packages still ship as `@earendil-works/pi-*` and remain compatible with upstream Pi tooling.

## Flow

```text
Chat model  →  ask_decision (questions + state)
                    ↓
Classifier  →  typed answers + probabilities
                    ↓
Harness     →  tool results, UI cards, routing, skills
```

1. **Question** — In decision-driven mode, the assistant may call the reserved `ask_decision` tool with a JSON `questions` object (and optional `state`). That call is not executed like a normal tool.
2. **Classify** — `@earendil-works/pi-agent-core` routes the questions to the configured `classify` hook (typically Jev via `@earendil-works/pi-coding-agent`'s model registry). The loop emits `decision_start` / `decision_end` with `{ phase, questions, answers? }`.
3. **Act** — Answers are returned to the chat model as the tool result. Extensions and virtual models can interpret them (for example plan-vs-build routing in [`jev-router.ts`](../packages/coding-agent/examples/extensions/jev-router.ts)).

Without a classifier, the loop stops in the `await_human` phase so a person can answer instead.

## Decision loop phases

The agent loop tracks a `DecisionPhase` through a single decision:

| Phase | Meaning |
|---|---|
| `question` | The model posed questions via `ask_decision`. |
| `classify` | A classifier is answering them. |
| `tool_args` | Answers are being turned into tool arguments (later waves). |
| `draft` | Output may be drafted and rolled back via message checkpoints. |
| `gate` | A quality gate checks the draft (config hooks; enforcement expands in later waves). |
| `await_human` | No classifier available; the run waits for a person. |

See `DecisionPhase` and `AgentLoopConfig` in `@earendil-works/pi-agent-core` for the full API.

## Wave 1 surfaces

| Surface | Where |
|---|---|
| `/classifier` | Pick the session classifier (Jev and others). Chat stays on `/model`. [models.md](../packages/coding-agent/docs/models.md#select-a-classifier-model) |
| `ask_decision` | Reserved tool name; decision-driven mode in the agent loop. [agent CHANGELOG](../packages/agent/CHANGELOG.md) |
| Questionnaire → classifier | `questionsToClassifierContext()` maps friendly questionnaire batches to `ClassifierContext`. [ai CHANGELOG](../packages/ai/CHANGELOG.md) |
| Decision cards (U1) | Interactive UI for `decision-request` / `decision-result` messages. Try `/decision-demo` via [decision-cards.ts](../packages/coding-agent/examples/extensions/decision-cards.ts). |
| Jev in skills & routers | Classifiers in codemode, extensions, and virtual models. [codemode.md](../packages/coding-agent/docs/codemode.md#classify), [virtual-models.md](../packages/coding-agent/docs/virtual-models.md#route-requests) |

## Plan vs build

Wave 1 includes patterns, not a single built-in mode switch. The Jev router example uses classifier answers to choose a strong model for planning and first edits, then a cheaper model for follow-up work—plan and build as router state rather than separate products.

Later waves wire `ask_decision` deeper into the coding-agent session, quality gates, and skill selection.

## Upstream

Decision-Driven tracks [earendil-works/pi](https://github.com/earendil-works/pi). Report fork-specific behavior in [rafasmour/pi-decision-driven](https://github.com/rafasmour/pi-decision-driven); consider upstreaming general Pi fixes to the main project.
