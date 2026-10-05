import { DECISION_TOOL_NAME } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { DecisionSessionPhase } from "./decision-session-phase.ts";

/** Tool call names from an assistant message (empty if none). */
export function assistantToolCallNames(message: AssistantMessage): string[] {
	const names: string[] = [];
	for (const block of message.content) {
		if (block.type === "toolCall") names.push(block.name);
	}
	return names;
}

/**
 * Ask/verify lockdown violation: not exactly one ask_decision tool call.
 * Text-only turns (no tool calls) count as violations.
 */
export function isAskDecisionOnlyViolation(message: AssistantMessage): boolean {
	const names = assistantToolCallNames(message);
	if (names.length === 0) return true;
	if (names.length !== 1) return true;
	return names[0] !== DECISION_TOOL_NAME;
}

export function askDecisionOnlyHarnessMessage(phase: "ask" | "verify"): string {
	const lines = [
		"<decision_harness>",
		"The previous assistant turn was removed from model context so history stays clean.",
	];
	if (phase === "ask") {
		lines.push(
			`Ask phase: call exactly one ${DECISION_TOOL_NAME} (no other tools, no text-only reply).`,
			"Ask the decision model — do not decide in prose.",
		);
	} else {
		lines.push(
			`Verify phase: call exactly one ${DECISION_TOOL_NAME} with a self-contained yes/no:`,
			'"Should we continue fixing / repeat before finishing?" (yes = keep fixing, no = settle).',
			"Include user goal, brief steps executed, and honest failures in the question prompt.",
		);
	}
	lines.push("</decision_harness>");
	return lines.join("\n");
}

export function phaseForAskDecisionOnly(phase: DecisionSessionPhase | undefined): "ask" | "verify" | undefined {
	if (phase === "ask" || phase === "verify") return phase;
	return undefined;
}
