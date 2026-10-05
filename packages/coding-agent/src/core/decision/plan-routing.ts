import type { ClassifierAnswer, ClassifierContext, ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai";
import type { GoalCard } from "./goal-card.ts";
import { goalCardClassifierState } from "./goal-card.ts";
import { type AskDecisionArguments, decisionKindForQuestion, toClassifierContext } from "./questionnaire.ts";

export const READY_TO_DRAFT_PLAN_ID = "ready_to_draft_plan";

/** Who answers an ask_decision question after the harness routes it. */
export type DecisionAnswerer = "jev" | "human";

/** @deprecated Prefer DecisionAnswerer — same values. */
export type PlanAnswerer = DecisionAnswerer;

export type AnswererRoutingPhase = "plan" | "build";

export function answererRoutingQuestionId(questionId: string): string {
	return `${questionId}__answerer`;
}

function routingCriteria(phase: AnswererRoutingPhase): { jev: string; human: string } {
	if (phase === "build") {
		return {
			jev: "Answerable from repository facts, docs, harness state, or standard engineering tradeoffs — prefer jev",
			human: "Requires the user's personal preference, product policy, priority, or explicit approval — not a technical default",
		};
	}
	return {
		jev: "Answerable from repository facts, docs, or standard engineering tradeoffs",
		human: "Requires user preference, product policy, priority, or approval",
	};
}

function routingInstructions(phase: AnswererRoutingPhase, prompt: string): string {
	if (phase === "build") {
		return `Who should answer this implementation question? Prefer jev unless it needs user preference or policy. ${prompt}`;
	}
	return `Who should answer this planning question? ${prompt}`;
}

/**
 * Per-question jev-vs-human routing classify context for plan or build ask_decision batches.
 * Skips `ready_to_draft_plan` and any ids in `skipQuestionIds`.
 */
export function answererRoutingContext(
	batch: AskDecisionArguments,
	goalCard: GoalCard | undefined,
	options?: {
		phase?: AnswererRoutingPhase;
		skipQuestionIds?: ReadonlySet<string>;
	},
): ClassifierContext {
	const phase = options?.phase ?? "plan";
	const skip = options?.skipQuestionIds;
	const criteria = routingCriteria(phase);
	const questions: Record<string, ClassifierQuestion> = {};
	for (const question of batch.questions) {
		if (question.id === READY_TO_DRAFT_PLAN_ID) continue;
		if (skip?.has(question.id)) continue;
		questions[answererRoutingQuestionId(question.id)] = {
			type: "choice",
			instructions: routingInstructions(phase, question.prompt),
			criteria,
		};
	}
	const state: JsonObject = {};
	if (goalCard) state.goal_card = goalCardClassifierState(goalCard);
	if (batch.goal?.trim()) {
		if (phase === "plan") state.planning_goal = batch.goal.trim();
		else state.goal = batch.goal.trim();
	}
	return { state, questions };
}

/** Plan-mode wrapper — same as `answererRoutingContext(..., { phase: "plan" })`. */
export function planAnswererRoutingContext(
	batch: AskDecisionArguments,
	goalCard: GoalCard | undefined,
): ClassifierContext {
	return answererRoutingContext(batch, goalCard, { phase: "plan" });
}

export function parseAnswererRouting(
	batch: AskDecisionArguments,
	answers: Record<string, ClassifierAnswer>,
	options?: { skipQuestionIds?: ReadonlySet<string> },
): Map<string, DecisionAnswerer> {
	const skip = options?.skipQuestionIds;
	const routing = new Map<string, DecisionAnswerer>();
	for (const question of batch.questions) {
		if (question.id === READY_TO_DRAFT_PLAN_ID) continue;
		if (skip?.has(question.id)) continue;
		const key = answererRoutingQuestionId(question.id);
		const answer = answers[key];
		if (answer?.type === "choice" && (answer.choice === "jev" || answer.choice === "human")) {
			routing.set(question.id, answer.choice);
		} else {
			// Fail closed to human so preference/policy questions are not answered by the classifier by accident.
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

export function questionIdsForAnswerer(routing: Map<string, DecisionAnswerer>, answerer: DecisionAnswerer): string[] {
	return [...routing.entries()].filter(([, route]) => route === answerer).map(([id]) => id);
}

export function routingAnswersForDisplay(routing: Map<string, DecisionAnswerer>): Record<string, ClassifierAnswer> {
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
			"Ask clarifying questions with the ask_decision tool (yes/no or multiple choice).",
			`When enough context is gathered, include a yes/no question asking whether to draft the plan (prefer id "${READY_TO_DRAFT_PLAN_ID}" or wording like "Ready to draft the plan?").`,
			"After the harness confirms ready_to_draft_plan, output numbered steps under a Plan: header.",
			"The harness routes each ask_decision question to the classifier (jev) or a human questionnaire — do not assume every question is answered by the user.",
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
