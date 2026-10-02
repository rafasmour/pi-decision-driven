import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import { contentText } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { emptyGoalCard } from "../src/core/decision/goal-card.ts";
import { goalCardWithPlanSteps } from "../src/core/decision/plan-approve.ts";
import { resolvePlanModeDecisionTurn } from "../src/core/decision/plan-mode-turn.ts";
import {
	parseAnswererRouting,
	planAnswererRoutingContext,
	READY_TO_DRAFT_PLAN_ID,
	splitPlanDecisionBatch,
} from "../src/core/decision/plan-routing.ts";
import type { AskDecisionArguments } from "../src/core/decision/questionnaire.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

const sampleBatch: AskDecisionArguments = {
	goal: "Add caching",
	questions: [
		{ id: "stack", prompt: "Which cache backend?" },
		{ id: "scope", prompt: "Ship in this PR?" },
		{ id: READY_TO_DRAFT_PLAN_ID, prompt: "Ready to draft the plan?" },
	],
};

describe("plan answerer routing", () => {
	it("builds a routing classify question per planning item", () => {
		const { planning } = splitPlanDecisionBatch(sampleBatch);
		const context = planAnswererRoutingContext(planning, emptyGoalCard());
		expect(Object.keys(context.questions)).toEqual(["stack__answerer", "scope__answerer"]);
	});

	it("maps routing classify answers to jev vs human", () => {
		const { planning } = splitPlanDecisionBatch(sampleBatch);
		const routing = parseAnswererRouting(planning, {
			stack__answerer: { type: "choice", choice: "jev", confidence: 0.9, probabilities: { jev: 0.9 } },
			scope__answerer: { type: "choice", choice: "human", confidence: 0.9, probabilities: { human: 0.9 } },
		});
		expect(routing.get("stack")).toBe("jev");
		expect(routing.get("scope")).toBe("human");
	});
});

describe("resolvePlanModeDecisionTurn", () => {
	it("classifies jev and human subsets then confirms ready_to_draft_plan", async () => {
		const classify = vi.fn(
			async (
				context: ClassifierContext,
			): Promise<Pick<ClassifierResult, "answers" | "stopReason" | "errorMessage">> => {
				if ("stack__answerer" in context.questions) {
					return {
						stopReason: "stop",
						answers: {
							stack__answerer: {
								type: "choice",
								choice: "jev",
								confidence: 0.9,
								probabilities: { jev: 0.9 },
							},
							scope__answerer: {
								type: "choice",
								choice: "human",
								confidence: 0.9,
								probabilities: { human: 0.9 },
							},
						},
					};
				}
				if ("stack" in context.questions) {
					return {
						stopReason: "stop",
						answers: {
							stack: { type: "choice", choice: "redis", confidence: 0.8, probabilities: { redis: 0.8 } },
						},
					};
				}
				if (READY_TO_DRAFT_PLAN_ID in context.questions) {
					return {
						stopReason: "stop",
						answers: {
							[READY_TO_DRAFT_PLAN_ID]: { type: "bool", probability: 0.92 },
						},
					};
				}
				return { stopReason: "error", answers: {}, errorMessage: "unexpected" };
			},
		);

		const ui = {
			select: vi.fn(async (title: string) => {
				if (title.includes("Ship")) return "Yes";
				return undefined;
			}),
		};

		const result = await resolvePlanModeDecisionTurn(sampleBatch, {
			goalCard: emptyGoalCard(),
			hooks: { classify },
			ui: ui as never,
			mode: "tui",
			skills: [],
			modelRuntime: {} as never,
		});

		expect(result.status).toBe("continue");
		if (result.status !== "continue") return;
		const last = result.messages.at(-1);
		expect(last?.role).toBe("user");
		expect(contentText(last?.role === "user" ? last.content : "", "")).toContain("ready_to_draft_plan confirmed");
		expect(classify).toHaveBeenCalledTimes(3);
		expect(ui.select).toHaveBeenCalled();
	});
});

describe("execute handoff GoalCard", () => {
	it("stores plan steps on the GoalCard", () => {
		const card = goalCardWithPlanSteps({ goal: "Add caching", recent: [], frozen: true }, [
			{ step: 1, text: "Inspect API", completed: false },
			{ step: 2, text: "Add Redis layer", completed: false },
		]);
		expect(card.plan?.steps).toEqual(["Inspect API", "Add Redis layer"]);
		expect(card.plan?.completed).toBe(0);
		expect(card.frozen).toBe(true);
	});
});

describe("plan_mode system section", () => {
	it("documents decisions blocks and ready_to_draft_plan when decision-driven", () => {
		const prompt = buildSystemPrompt({
			decisionDriven: true,
			sections: { plan_mode: "test plan section" },
			selectedTools: ["read"],
			toolSnippets: { read: "Read files" },
			contextFiles: [],
			cwd: "/tmp",
		});
		expect(prompt).toContain("<plan_mode>");
	});
});
