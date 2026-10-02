import type { ClassifierAnswer, ClassifierContext, ClassifierResult, JsonObject } from "@earendil-works/pi-ai";
import { capDraftText } from "./draft-heuristic.ts";
import type { GoalCard } from "./goal-card.ts";
import { goalCardClassifierState } from "./goal-card.ts";

export type QualityRoute =
	| "prompt_user"
	| "incomplete_continue"
	| "poor_quality_try_again"
	| "poor_quality_prompt_user";

export interface QualityGateResult {
	route: QualityRoute;
	onGoal: number;
	answers: Record<string, ClassifierAnswer>;
}

export function qualityGateClassifierContext(goalCard: GoalCard, draft: string): ClassifierContext {
	const state: JsonObject = {
		goal_card: goalCardClassifierState(goalCard),
		draft: capDraftText(draft, 4_000),
	};
	return {
		state,
		questions: {
			routing: {
				type: "choice",
				instructions:
					"Given goal_card and draft, how should the harness handle this assistant draft before showing it to the user?",
				criteria: {
					prompt_user: "Draft is OK to show; no harness action",
					incomplete_continue: "Draft is partial; model should continue working",
					poor_quality_try_again: "Draft misses the goal; retry generation",
					poor_quality_prompt_user: "Draft is poor after retries; ask the human",
				},
			},
			on_goal: {
				type: "bool",
				instructions: "Does draft satisfy goal_card.goal and goal_card.criteria?",
				criteria: {
					true: "Draft meets the goal",
					false: "Draft misses the goal",
				},
			},
		},
	};
}

export function parseQualityGateResult(result: Pick<ClassifierResult, "answers" | "stopReason">): QualityGateResult {
	const fallback: QualityGateResult = {
		route: "prompt_user",
		onGoal: 1,
		answers: result.answers,
	};
	if (result.stopReason !== "stop") return fallback;

	const routing = result.answers.routing;
	let route: QualityRoute = "prompt_user";
	if (routing?.type === "choice") {
		const token = routing.choice as QualityRoute;
		if (
			token === "incomplete_continue" ||
			token === "poor_quality_try_again" ||
			token === "poor_quality_prompt_user" ||
			token === "prompt_user"
		) {
			route = token;
		}
	}

	const onGoalAnswer = result.answers.on_goal;
	const onGoal = onGoalAnswer?.type === "bool" ? onGoalAnswer.probability : 1;

	if (onGoalAnswer?.type === "bool" && onGoalAnswer.probability < 0.5) {
		route = route === "prompt_user" ? "poor_quality_try_again" : route;
	}

	return { route, onGoal, answers: result.answers };
}

export function applyQualityRouteWithRetries(
	parsed: QualityGateResult,
	qualityRetriesUsed: number,
	maxQualityRetries: number,
): QualityRoute {
	if (parsed.route !== "poor_quality_try_again" && parsed.route !== "incomplete_continue") return parsed.route;
	if (parsed.route === "poor_quality_try_again" && qualityRetriesUsed < maxQualityRetries) {
		return "poor_quality_try_again";
	}
	if (parsed.route === "poor_quality_try_again") return "poor_quality_prompt_user";
	return parsed.route;
}
