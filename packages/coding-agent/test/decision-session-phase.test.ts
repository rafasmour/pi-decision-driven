import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { assistantTextHasCheckboxList, extractCheckboxTodoItems } from "../src/core/decision/act-checklist.ts";
import { isAskDecisionOnlyViolation } from "../src/core/decision/ask-phase-undo.ts";
import {
	isGoalClear,
	resolveDecisionSessionPhase,
	shouldInjectDecisionLoop,
} from "../src/core/decision/decision-session-phase.ts";
import { emptyGoalCard } from "../src/core/decision/goal-card.ts";
import {
	parseGoalClarityFromAnswers,
	parseVerifyContinueFixingFromAnswers,
} from "../src/core/decision/verify-route.ts";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

describe("resolveDecisionSessionPhase", () => {
	it("returns undefined when decision-driven is off", () => {
		expect(
			resolveDecisionSessionPhase({
				decisionDriven: false,
				respondAuthorized: false,
				verifying: false,
			}),
		).toBeUndefined();
	});

	it("resolves ask / nudge / act / verify", () => {
		expect(
			resolveDecisionSessionPhase({
				decisionDriven: true,
				respondAuthorized: false,
				verifying: false,
			}),
		).toBe("ask");
		expect(
			resolveDecisionSessionPhase({
				decisionDriven: true,
				respondAuthorized: true,
				verifying: false,
				goalCard: emptyGoalCard(),
			}),
		).toBe("nudge");
		expect(
			resolveDecisionSessionPhase({
				decisionDriven: true,
				respondAuthorized: true,
				verifying: false,
				goalCard: { goal: "Ship the login feature safely", recent: [] },
			}),
		).toBe("act");
		expect(
			resolveDecisionSessionPhase({
				decisionDriven: true,
				respondAuthorized: true,
				verifying: true,
				goalCard: { goal: "Ship the login feature safely", recent: [] },
			}),
		).toBe("verify");
	});

	it("isGoalClear uses min length", () => {
		expect(isGoalClear({ goal: "short", recent: [] })).toBe(false);
		expect(isGoalClear({ goal: "long enough goal text", recent: [] })).toBe(true);
	});

	it("injects decision_loop for all harness phases", () => {
		expect(shouldInjectDecisionLoop("ask")).toBe(true);
		expect(shouldInjectDecisionLoop("nudge")).toBe(true);
		expect(shouldInjectDecisionLoop("act")).toBe(true);
		expect(shouldInjectDecisionLoop("verify")).toBe(true);
		expect(shouldInjectDecisionLoop(undefined)).toBe(false);
	});
});

describe("ask-phase undo", () => {
	it("flags text-only and non-ask tools", () => {
		expect(isAskDecisionOnlyViolation(assistant([{ type: "text", text: "hi" }]))).toBe(true);
		expect(isAskDecisionOnlyViolation(assistant([{ type: "toolCall", id: "1", name: "write", arguments: {} }]))).toBe(
			true,
		);
		expect(
			isAskDecisionOnlyViolation(
				assistant([{ type: "toolCall", id: "1", name: "ask_decision", arguments: { questions: [] } }]),
			),
		).toBe(false);
	});
});

describe("verify / nudge answer routing", () => {
	it("parses continue-fix yes/no", () => {
		expect(parseVerifyContinueFixingFromAnswers({ q: { type: "bool", probability: 0.9 } })).toBe(true);
		expect(parseVerifyContinueFixingFromAnswers({ q: { type: "bool", probability: 0.1 } })).toBe(false);
		expect(
			parseVerifyContinueFixingFromAnswers({
				q: { type: "choice", choice: "settle", probabilities: { settle: 1 }, confidence: 1 },
			}),
		).toBe(false);
	});

	it("parses goal_clear", () => {
		expect(parseGoalClarityFromAnswers({ goal_clear: { type: "bool", probability: 0.8 } })).toBe(true);
		expect(parseGoalClarityFromAnswers({ goal_clear: { type: "bool", probability: 0.2 } })).toBe(false);
	});
});

describe("act checklist", () => {
	it("extracts markdown checkboxes", () => {
		const text = "Plan:\n- [ ] Write tests\n- [x] Done already\n☐ Unicode item";
		expect(extractCheckboxTodoItems(text)).toEqual(["Write tests", "Done already", "Unicode item"]);
		expect(assistantTextHasCheckboxList(text)).toBe(true);
		expect(assistantTextHasCheckboxList("no list here")).toBe(false);
	});
});
