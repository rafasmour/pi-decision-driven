import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonObject } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	enrichDecisionClassifierContext,
	fingerprintToolCall,
	lastUserRequestText,
	RECENT_TOOLS_CAP,
	summarizeRecentToolActivity,
} from "../src/core/decision/classifier-session-state.ts";
import type { GoalCard } from "../src/core/decision/goal-card.ts";

function assistantWithTools(calls: Array<{ name: string; arguments?: JsonObject }>): AgentMessage {
	return {
		role: "assistant",
		content: calls.map((call, index) => ({
			type: "toolCall" as const,
			id: `call_${index}`,
			name: call.name,
			arguments: call.arguments ?? {},
		})),
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 0,
	};
}

function user(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 0 };
}

describe("fingerprintToolCall", () => {
	it("prefers path, then command, then first string arg", () => {
		expect(fingerprintToolCall("write", { path: "index.html", content: "huge" })).toBe("write path=index.html");
		expect(fingerprintToolCall("bash", { command: "npm test" })).toBe("bash cmd=npm test");
		expect(fingerprintToolCall("grep", { pattern: "foo" })).toBe("grep pattern=foo");
	});
});

describe("summarizeRecentToolActivity", () => {
	it("skips ask_decision and keeps last K fingerprints without result bodies", () => {
		const messages: AgentMessage[] = [
			assistantWithTools([{ name: "ask_decision", arguments: { questions: [] } }]),
			assistantWithTools([{ name: "read", arguments: { path: "a.ts" } }]),
			assistantWithTools([{ name: "write", arguments: { path: "b.ts" } }]),
			{
				role: "toolResult",
				toolCallId: "x",
				toolName: "write",
				content: [{ type: "text", text: "WROTE HUGE STDOUT THAT MUST NOT APPEAR" }],
				isError: false,
				timestamp: 0,
			},
		];
		expect(summarizeRecentToolActivity(messages, 8)).toEqual(["read path=a.ts", "write path=b.ts"]);
	});

	it("caps at RECENT_TOOLS_CAP", () => {
		const calls = Array.from({ length: RECENT_TOOLS_CAP + 3 }, (_, i) => ({
			name: "read",
			arguments: { path: `f${i}.ts` },
		}));
		const lines = summarizeRecentToolActivity([assistantWithTools(calls)]);
		expect(lines).toHaveLength(RECENT_TOOLS_CAP);
		expect(lines[0]).toBe(`read path=f3.ts`);
		expect(lines.at(-1)).toBe(`read path=f${RECENT_TOOLS_CAP + 2}.ts`);
	});
});

describe("lastUserRequestText", () => {
	it("returns the last non-harness user message", () => {
		const messages: AgentMessage[] = [
			user("first"),
			user("create an index.html"),
			user("<decision_harness>retry</decision_harness>"),
		];
		expect(lastUserRequestText(messages)).toBe("create an index.html");
	});
});

describe("enrichDecisionClassifierContext", () => {
	it("overwrites reserved keys with GoalCard, user_request, and recent_tools", () => {
		const goalCard: GoalCard = {
			goal: "Ship index.html",
			criteria: "Page exists",
			recent: ["intent: write"],
		};
		const messages: AgentMessage[] = [
			user("create an index.html for pi-decision-driven"),
			assistantWithTools([{ name: "write", arguments: { path: "index.html" } }]),
		];
		const enriched = enrichDecisionClassifierContext(
			{
				state: {
					goal_card: { goal: "stale" },
					user_request: "stale user",
					recent_tools: ["stale"],
					custom_fact: "keep-me",
				},
				questions: {
					go: { type: "bool", instructions: "Proceed?", criteria: { true: "yes", false: "no" } },
				},
			},
			{ goalCard, messages },
		);

		expect(enriched.state.custom_fact).toBe("keep-me");
		expect(enriched.state.user_request).toBe("create an index.html for pi-decision-driven");
		expect(enriched.state.recent_tools).toEqual(["write path=index.html"]);
		expect(enriched.state.goal_card).toMatchObject({
			goal: "Ship index.html",
			criteria: "Page exists",
			recent_intents: ["intent: write"],
		});
		expect(enriched.questions.go?.type).toBe("bool");
	});

	it("omits empty user_request and recent_tools", () => {
		const enriched = enrichDecisionClassifierContext(
			{ state: { user_request: "x", recent_tools: ["y"] }, questions: {} },
			{ goalCard: { goal: "", recent: [] }, messages: [] },
		);
		expect(enriched.state.user_request).toBeUndefined();
		expect(enriched.state.recent_tools).toBeUndefined();
		expect(enriched.state.goal_card).toMatchObject({ goal: "" });
	});
});
