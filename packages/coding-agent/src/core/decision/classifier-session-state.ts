import { type AgentMessage, DECISION_TOOL_NAME } from "@earendil-works/pi-agent-core";
import type { ClassifierContext, JsonObject } from "@earendil-works/pi-ai";
import { contentText } from "@earendil-works/pi-ai";
import { emptyGoalCard, type GoalCard, mergeGoalCardState } from "./goal-card.ts";

export const RECENT_TOOLS_CAP = 8;
export const TOOL_FINGERPRINT_MAX = 120;
export const USER_REQUEST_MAX = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max);
}

/** Compact one-line fingerprint for a tool call (no stdout). */
export function fingerprintToolCall(name: string, args: Record<string, unknown> | undefined): string {
	const parts: string[] = [name];
	if (args) {
		if (typeof args.path === "string" && args.path.trim()) {
			parts.push(`path=${truncate(args.path.trim(), 80)}`);
		} else if (typeof args.command === "string" && args.command.trim()) {
			parts.push(`cmd=${truncate(args.command.trim().replace(/\s+/g, " "), 80)}`);
		} else {
			for (const [key, value] of Object.entries(args)) {
				if (typeof value === "string" && value.trim()) {
					parts.push(`${key}=${truncate(value.trim().replace(/\s+/g, " "), 60)}`);
					break;
				}
			}
		}
	}
	return truncate(parts.join(" "), TOOL_FINGERPRINT_MAX);
}

/**
 * Last K assistant tool-call fingerprints from the message branch (oldest→newest among the kept
 * window). Skips `ask_decision`. Does not read toolResult bodies.
 */
export function summarizeRecentToolActivity(messages: readonly AgentMessage[], limit = RECENT_TOOLS_CAP): string[] {
	if (limit <= 0) return [];
	const fingerprints: string[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		if (!("content" in message) || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (!isRecord(part) || part.type !== "toolCall") continue;
			if (typeof part.name !== "string" || part.name === DECISION_TOOL_NAME) continue;
			const args = isRecord(part.arguments) ? part.arguments : undefined;
			fingerprints.push(fingerprintToolCall(part.name, args));
		}
	}
	return fingerprints.slice(-limit);
}

/** Last user message text, capped. Skips harness-only decision notes when possible. */
export function lastUserRequestText(messages: readonly AgentMessage[], max = USER_REQUEST_MAX): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (!message || message.role !== "user") continue;
		const text =
			typeof message.content === "string"
				? message.content
				: Array.isArray(message.content)
					? contentText(message.content, "")
					: "";
		const trimmed = text.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("<decision_harness>")) continue;
		return truncate(trimmed, max);
	}
	return undefined;
}

export interface EnrichDecisionClassifierOptions {
	goalCard?: GoalCard;
	messages: readonly AgentMessage[];
}

/**
 * Harness-owned Ask / quality-gate state: overwrites `goal_card`, `user_request`, `recent_tools`.
 * Does not dump transcripts or tool stdout.
 */
export function enrichDecisionClassifierContext(
	context: ClassifierContext,
	options: EnrichDecisionClassifierOptions,
): ClassifierContext {
	const goalCard = options.goalCard ?? emptyGoalCard();
	let next = mergeGoalCardState(context, goalCard);
	const state: JsonObject = { ...next.state };

	const userRequest = lastUserRequestText(options.messages);
	if (userRequest) state.user_request = userRequest;
	else delete state.user_request;

	const recentTools = summarizeRecentToolActivity(options.messages);
	if (recentTools.length > 0) state.recent_tools = recentTools;
	else delete state.recent_tools;

	next = { ...next, state };
	return next;
}
