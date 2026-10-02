import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { findLowConfidenceAnswers } from "../src/core/decision/confidence-gate.ts";
import { applyToolRestriction } from "../src/core/decision/decision-gates-session.ts";
import { isUserFacingDraft } from "../src/core/decision/draft-heuristic.ts";
import {
	appendGoalCardRecent,
	GOAL_CARD_RECENT_CAP,
	goalCardClassifierState,
	loadGoalCardFromBranch,
	persistGoalCard,
} from "../src/core/decision/goal-card.ts";
import { mergeRefinedGoalCard } from "../src/core/decision/goal-refine.ts";
import { parseOffPlanResult } from "../src/core/decision/off-plan.ts";
import { applyQualityRouteWithRetries, parseQualityGateResult } from "../src/core/decision/quality-gate.ts";
import { isStaticallyDeniedBash } from "../src/core/decision/security-gate.ts";
import { detectToolIntentFromAnswers, toolNamesForIntent } from "../src/core/decision/tool-intent.ts";
import { SessionManager } from "../src/core/session-manager.ts";

function assistant(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "openai-responses" as const,
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
		stopReason: "stop" as const,
		timestamp: 0,
	};
}

describe("GoalCard GC2", () => {
	it("persists on the session branch and reloads", () => {
		const session = SessionManager.inMemory();
		const card = { goal: "Ship feature", criteria: "Tests pass", recent: [], frozen: true };
		persistGoalCard(session, card);
		const loaded = loadGoalCardFromBranch(session.getBranch());
		expect(loaded).toEqual(card);
	});

	it("caps recent intent summaries", () => {
		let card = { goal: "g", recent: [] as string[] };
		for (let i = 0; i < GOAL_CARD_RECENT_CAP + 3; i++) {
			card = appendGoalCardRecent(card, `intent-${i}`);
		}
		expect(card.recent).toHaveLength(GOAL_CARD_RECENT_CAP);
		expect(card.recent[0]).toBe("intent-3");
	});

	it("exports compact classifier state without tool payloads", () => {
		const state = goalCardClassifierState({
			goal: "Fix bug",
			criteria: "Minimal diff",
			recent: ["intent: read"],
			plan: { steps: ["Investigate", "Patch"], completed: 1 },
		});
		expect(state).toMatchObject({ goal: "Fix bug", plan_steps_remaining: ["Patch"] });
		expect(JSON.stringify(state).length).toBeLessThan(2_000);
	});

	it("refines goal from first user line", () => {
		const card = mergeRefinedGoalCard("Build the login flow\nextra detail", {
			answers: { goal_clear: { type: "bool", probability: 0.9 } },
			stopReason: "stop",
		});
		expect(card.goal).toBe("Build the login flow");
		expect(card.frozen).toBe(true);
	});
});

describe("R1 quality gate", () => {
	it("treats on_goal false as try_again", () => {
		const parsed = parseQualityGateResult({
			stopReason: "stop",
			answers: {
				routing: {
					type: "choice",
					choice: "prompt_user",
					confidence: 0.8,
					probabilities: { prompt_user: 0.8 },
				},
				on_goal: { type: "bool", probability: 0.2 },
			},
		});
		expect(parsed.route).toBe("poor_quality_try_again");
		expect(parsed.onGoal).toBeLessThan(0.5);
	});

	it("caps retries then prompts user", () => {
		const parsed = parseQualityGateResult({
			stopReason: "stop",
			answers: {
				routing: {
					type: "choice",
					choice: "poor_quality_try_again",
					confidence: 0.9,
					probabilities: { poor_quality_try_again: 0.9 },
				},
				on_goal: { type: "bool", probability: 0.2 },
			},
		});
		expect(applyQualityRouteWithRetries(parsed, 0, 2)).toBe("poor_quality_try_again");
		expect(applyQualityRouteWithRetries(parsed, 2, 2)).toBe("poor_quality_prompt_user");
	});
});

describe("D1 tool_args restriction", () => {
	it("detects tool intent from choice answers", () => {
		const batch = {
			questions: [{ id: "intent", prompt: "Next step?", options: [{ value: "read", label: "Read files" }] }],
		};
		const answers: Record<string, ClassifierAnswer> = {
			intent: { type: "choice", choice: "read", confidence: 0.9, probabilities: { read: 0.9 } },
		};
		expect(detectToolIntentFromAnswers(batch, answers)).toBe("read");
		const restricted = toolNamesForIntent("read", ["read", "bash", "edit", "write", "ask_decision"]);
		expect(restricted).toEqual(["read", "ask_decision"]);
	});

	it("filters agent context tools to the restricted family", () => {
		const readTool = {
			name: "read",
			label: "Read",
			description: "",
			parameters: {},
			execute: async () => ({ content: [], details: {} }),
		};
		const bashTool = {
			name: "bash",
			label: "Bash",
			description: "",
			parameters: {},
			execute: async () => ({ content: [], details: {} }),
		};
		const next = applyToolRestriction({ messages: [], tools: [readTool, bashTool] }, ["read"]);
		expect(next.tools?.map((tool) => tool.name)).toEqual(["read"]);
	});
});

describe("D3 off_plan", () => {
	it("flags off_plan classifier choice", () => {
		const result = parseOffPlanResult(
			{
				stopReason: "stop",
				answers: {
					alignment: {
						type: "choice",
						choice: "off_plan",
						confidence: 0.8,
						probabilities: { off_plan: 0.8 },
					},
				},
			},
			2,
		);
		expect(result.offPlan).toBe(true);
	});

	it("accepts matching plan step index", () => {
		const result = parseOffPlanResult(
			{
				stopReason: "stop",
				answers: {
					alignment: {
						type: "choice",
						choice: "step_0",
						confidence: 0.8,
						probabilities: { step_0: 0.8 },
					},
				},
			},
			2,
		);
		expect(result.offPlan).toBe(false);
	});
});

describe("X3 security", () => {
	it("denies dangerous bash statically", () => {
		expect(isStaticallyDeniedBash("git push --force origin main")).toBe(true);
		expect(isStaticallyDeniedBash("ls -la")).toBe(false);
	});
});

describe("draft heuristic", () => {
	it("detects tool-free drafts without decisions blocks", () => {
		expect(isUserFacingDraft(assistant("Here is the summary for you."))).toBe(true);
		expect(isUserFacingDraft(assistant('Question?\n```decisions\n{"questions":[]}\n```'))).toBe(false);
	});
});

describe("confidence gate", () => {
	it("finds low-confidence choice answers", () => {
		const low = findLowConfidenceAnswers(
			{},
			{
				go: { type: "choice", choice: "a", confidence: 0.4, probabilities: { a: 0.4, b: 0.35 } },
			},
			0.65,
		);
		expect(low).toHaveLength(1);
		expect(low[0]?.questionId).toBe("go");
	});
});
