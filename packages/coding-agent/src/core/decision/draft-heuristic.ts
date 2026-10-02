import { type AssistantMessage, contentText } from "@earendil-works/pi-ai";
import { DECISION_BLOCK_FENCE, parseDecisionBlockFromText } from "./parse-decision-block.ts";

/** Tool-free assistant turn with no ```decisions fence — candidate user-facing draft for R1. */
export function isUserFacingDraft(message: AssistantMessage): boolean {
	if (message.stopReason === "error" || message.stopReason === "aborted") return false;
	const hasToolCall = message.content.some((part) => part.type === "toolCall");
	if (hasToolCall) return false;
	const text = contentText(message.content, "").trim();
	if (!text) return false;
	if (text.includes(DECISION_BLOCK_FENCE) || parseDecisionBlockFromText(text)) return false;
	return true;
}

export function draftTextFromAssistant(message: AssistantMessage): string {
	return capDraftText(contentText(message.content, ""));
}

export function capDraftText(text: string, max = 8_000): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return trimmed.slice(0, max);
}
