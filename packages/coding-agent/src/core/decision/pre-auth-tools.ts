import { DECISION_TOOL_NAME } from "@earendil-works/pi-agent-core";

/** Tool names allowed before the first successful decision classify. */
export const DECISION_PRE_AUTH_READ_TOOLS = ["read", "grep", "find", "ls"] as const;

export function decisionPreAuthToolNames(activeToolNames: readonly string[]): string[] {
	const allowed = new Set<string>([DECISION_TOOL_NAME, ...DECISION_PRE_AUTH_READ_TOOLS]);
	return activeToolNames.filter((name) => allowed.has(name));
}
