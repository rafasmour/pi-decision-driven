import { DECISION_TOOL_NAME } from "@earendil-works/pi-agent-core";

/**
 * Tools allowed before the first successful decision classify unlocks Act tools.
 * Ask-only: no read/explore tools so the chat model cannot drift into agentic exploration.
 */
export function decisionPreAuthToolNames(activeToolNames: readonly string[]): string[] {
	return activeToolNames.filter((name) => name === DECISION_TOOL_NAME);
}
