import type { ClassifierAnswer, ClassifierContext, ClassifierResult, JsonObject } from "@earendil-works/pi-ai";
import type { GoalCard } from "./goal-card.ts";
import { capStateField, goalCardClassifierState, remainingPlanSteps } from "./goal-card.ts";

export interface OffPlanResult {
	offPlan: boolean;
	answers: Record<string, ClassifierAnswer>;
}

export function offPlanClassifierContext(goalCard: GoalCard, proposedIntent: string): ClassifierContext | undefined {
	const steps = remainingPlanSteps(goalCard);
	if (steps.length === 0) return undefined;
	const stepCriteria: Record<string, string> = {};
	for (let i = 0; i < steps.length; i++) {
		stepCriteria[`step_${i}`] = capStateField(steps[i]!, 256);
	}
	stepCriteria.off_plan = "Intent is not covered by any remaining plan step";
	const state: JsonObject = {
		goal_card: goalCardClassifierState(goalCard),
		proposed_intent: capStateField(proposedIntent, 512),
	};
	return {
		state,
		questions: {
			alignment: {
				type: "choice",
				instructions: "Which remaining plan step does proposed_intent advance, if any?",
				criteria: stepCriteria,
			},
		},
	};
}

export function parseOffPlanResult(
	result: Pick<ClassifierResult, "answers" | "stopReason">,
	remainingStepCount: number,
): OffPlanResult {
	if (result.stopReason !== "stop") return { offPlan: true, answers: result.answers };
	const answer = result.answers.alignment;
	if (answer?.type !== "choice") return { offPlan: true, answers: result.answers };
	if (answer.choice === "off_plan") return { offPlan: true, answers: result.answers };
	const match = /^step_(\d+)$/.exec(answer.choice);
	if (!match) return { offPlan: true, answers: result.answers };
	const index = Number.parseInt(match[1]!, 10);
	if (!Number.isFinite(index) || index < 0 || index >= remainingStepCount) {
		return { offPlan: true, answers: result.answers };
	}
	return { offPlan: false, answers: result.answers };
}
