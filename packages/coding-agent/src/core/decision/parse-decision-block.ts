import { type AssistantMessage, contentText } from "@earendil-works/pi-ai";
import { type AskDecisionArguments, parseAskDecisionArguments } from "./questionnaire.ts";

/** Opening fence for decision batches embedded in assistant text. */
export const DECISION_BLOCK_FENCE = "```decisions";

const DECISION_BLOCK_PATTERN = /```decisions\s*\n([\s\S]*?)```/;

/**
 * Parse a `decisions` fenced JSON block from assistant text.
 * See system prompt for the schema (`questions` array with optional `goal` and `state`).
 */
export function parseDecisionBlockFromText(text: string): AskDecisionArguments | undefined {
	const match = DECISION_BLOCK_PATTERN.exec(text);
	if (!match) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(match[1].trim());
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	return parseAskDecisionArguments(parsed as Record<string, unknown>);
}

export function parseDecisionBlockFromAssistant(message: AssistantMessage): AskDecisionArguments | undefined {
	return parseDecisionBlockFromText(contentText(message.content, ""));
}
