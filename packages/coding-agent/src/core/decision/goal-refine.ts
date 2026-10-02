import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import type { GoalCard } from "./goal-card.ts";
import { capStateField } from "./goal-card.ts";

export function goalRefineClassifierContext(userMessage: string): ClassifierContext {
	return {
		state: { user_message: capStateField(userMessage.trim(), 4_000) },
		questions: {
			goal_clear: {
				type: "bool",
				instructions: "Does user_message state a clear, actionable goal for a coding assistant?",
				criteria: {
					true: "Clear goal",
					false: "Vague or missing goal",
				},
			},
		},
	};
}

export function goalCardFromUserMessage(userMessage: string): GoalCard {
	const firstLine = userMessage.trim().split(/\n/)[0]?.trim() ?? "";
	const goal = capStateField(firstLine || userMessage.trim(), 240);
	return {
		goal,
		criteria: "Address the user request accurately and completely.",
		recent: [],
		frozen: true,
	};
}

export function mergeRefinedGoalCard(
	userMessage: string,
	result: Pick<ClassifierResult, "answers" | "stopReason">,
): GoalCard {
	const base = goalCardFromUserMessage(userMessage);
	if (result.stopReason !== "stop") return base;
	const clear = result.answers.goal_clear;
	if (clear?.type === "bool" && clear.probability < 0.5 && base.goal.length < 12) {
		return {
			...base,
			criteria: "Clarify ambiguous parts of the request before implementing.",
		};
	}
	return base;
}
