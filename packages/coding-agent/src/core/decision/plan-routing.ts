import type { ClassifierAnswer, ClassifierContext, ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai";
import type { GoalCard } from "./goal-card.ts";
import { goalCardClassifierState } from "./goal-card.ts";
import { type AskDecisionArguments, decisionKindForQuestion, toClassifierContext } from "./questionnaire.ts";

export const READY_TO_DRAFT_PLAN_ID = "ready_to_draft_plan";

export type PlanAnswerer = "jev" | "human";

export function answererRoutingQuestionId(questionId: string): string {
	return `${questionId}__answerer`;
}

export function planAnswererRoutingContext(
	batch: AskDecisionArguments,
	goalCard: GoalCard | undefined,
): ClassifierContext {
	const questions: Record<string, ClassifierQuestion> = {};
	for (const question of batch.questions) {
		if (question.id === READY_TO_DRAFT_PLAN_ID) continue;
		questions[answererRoutingQuestionId(question.id)] = {
			type: "choice",
			instructions: `Who should answer this planning question? ${question.prompt}`,
			criteria: {
				jev: "Answerable from repository facts, docs, or standard engineering tradeoffs",
				human: "Requires user preference, product policy, priority, or approval",
			},
		};
	}
	const state: JsonObject = {};
	if (goalCard) state.goal_card = goalCardClassifierState(goalCard);
	if (batch.goal?.trim()) state.planning_goal = batch.goal.trim();
	return { state, questions };
}

export function parseAnswererRouting(
	batch: AskDecisionArguments,
	answers: Record<string, ClassifierAnswer>,
): Map<string, PlanAnswerer> {
	const routing = new Map<string, PlanAnswerer>();
	for (const question of batch.questions) {
		if (question.id === READY_TO_DRAFT_PLAN_ID) continue;
		const key = answererRoutingQuestionId(question.id);
		const answer = answers[key];
		if (answer?.type === "choice" && (answer.choice === "jev" || answer.choice === "human")) {
			routing.set(question.id, answer.choice);
		} else {
			routing.set(question.id, "human");
		}
	}
	return routing;
}

export function filterDecisionBatch(batch: AskDecisionArguments, questionIds: Set<string>): AskDecisionArguments {
	return {
		...batch,
		questions: batch.questions.filter((question) => questionIds.has(question.id)),
	};
}

export function splitPlanDecisionBatch(batch: AskDecisionArguments): {
	planning: AskDecisionArguments;
	hasReadyToDraft: boolean;
} {
	const planningQuestions = batch.questions.filter((question) => question.id !== READY_TO_DRAFT_PLAN_ID);
	const hasReadyToDraft = batch.questions.some((question) => question.id === READY_TO_DRAFT_PLAN_ID);
	return {
		planning: { ...batch, questions: planningQuestions },
		hasReadyToDraft,
	};
}

export function readyToDraftClassifierContext(
	batch: AskDecisionArguments,
	goalCard: GoalCard | undefined,
): ClassifierContext {
	const readyQuestion = batch.questions.find((question) => question.id === READY_TO_DRAFT_PLAN_ID);
	const base = readyQuestion
		? toClassifierContext({ ...batch, questions: [readyQuestion] })
		: toClassifierContext({
				...batch,
				questions: [
					{
						id: READY_TO_DRAFT_PLAN_ID,
						prompt: "Is there enough context to draft a numbered implementation plan?",
					},
				],
			});
	if (!goalCard) return base;
	return {
		...base,
		state: { ...base.state, goal_card: goalCardClassifierState(goalCard) },
	};
}

export function isReadyToDraftConfirmed(answers: Record<string, ClassifierAnswer>): boolean {
	const answer = answers[READY_TO_DRAFT_PLAN_ID];
	return answer?.type === "bool" && answer.probability >= 0.5;
}

export function mergeClassifierAnswers(
	...maps: Array<Record<string, ClassifierAnswer>>
): Record<string, ClassifierAnswer> {
	const merged: Record<string, ClassifierAnswer> = {};
	for (const map of maps) {
		for (const [key, value] of Object.entries(map)) merged[key] = value;
	}
	return merged;
}

export function questionIdsForAnswerer(routing: Map<string, PlanAnswerer>, answerer: PlanAnswerer): string[] {
	return [...routing.entries()].filter(([, route]) => route === answerer).map(([id]) => id);
}

export function routingAnswersForDisplay(routing: Map<string, PlanAnswerer>): Record<string, ClassifierAnswer> {
	const answers: Record<string, ClassifierAnswer> = {};
	for (const [questionId, answerer] of routing) {
		answers[answererRoutingQuestionId(questionId)] = {
			type: "choice",
			choice: answerer,
			confidence: 1,
			probabilities: { [answerer]: 1 },
		};
	}
	return answers;
}

export function planDraftHarnessUserMessage(): string {
	return '<decision_harness>ready_to_draft_plan confirmed. Output a numbered plan under a "Plan:" header. Use read-only tools if needed, but do not edit files in this turn.</decision_harness>';
}

export function planModeSystemSection(decisionDriven: boolean): string {
	const lines = [
		"[PLAN MODE ACTIVE]",
		"Read-only exploration until the user executes an approved plan.",
		"Built-in edit and write tools are disabled; bash is restricted to read-only commands.",
		"Use exploration tools (read, grep, find, ls, bash) to understand the codebase.",
	];
	if (decisionDriven) {
		lines.push(
			"Ask clarifying questions only via a single ```decisions JSON block per turn (see decisions_format).",
			`When enough context is gathered, include a yes/no question with id "${READY_TO_DRAFT_PLAN_ID}" asking whether to draft the plan.`,
			"After the harness confirms ready_to_draft_plan, output numbered steps under a Plan: header.",
			"Do not use the questionnaire tool for plan clarifications.",
		);
	} else {
		lines.push(
			"Ask clarifying questions in plain text when needed.",
			"After analysis, output numbered steps under a Plan: header.",
		);
	}
	return lines.join("\n");
}

export function decisionKindLabel(question: AskDecisionArguments["questions"][number]): "bool" | "choice" {
	return decisionKindForQuestion(question);
}
