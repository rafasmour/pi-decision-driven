import type { ClassifierAnswer, ClassifierResult } from "@earendil-works/pi-ai";
import { type AskDecisionArguments, decisionKindForQuestion, toDecisionRequest } from "./questionnaire.ts";
import type {
	DecisionAnswer,
	DecisionBoolAnswer,
	DecisionChoiceAnswer,
	DecisionRequest,
	DecisionResult,
} from "./types.ts";

function choiceProbabilities(
	answer: Extract<ClassifierAnswer, { type: "choice" }>,
	options: DecisionRequest["questions"][number]["options"],
): Record<string, number> {
	if (options && options.length > 0) {
		const probabilities: Record<string, number> = {};
		for (const option of options) {
			probabilities[option.value] = option.value === answer.choice ? answer.confidence : 0;
		}
		return probabilities;
	}
	return { [answer.choice]: answer.confidence };
}

export function classifierAnswerToDecisionAnswer(
	batch: AskDecisionArguments,
	questionId: string,
	answer: ClassifierAnswer | undefined,
): DecisionAnswer | undefined {
	const question = batch.questions.find((q) => q.id === questionId);
	if (!question || !answer) return undefined;

	if (answer.type === "bool") {
		const bool: DecisionBoolAnswer = {
			kind: "bool",
			questionId,
			value: answer.probability >= 0.5,
			probability: answer.probability,
		};
		return bool;
	}
	if (answer.type === "choice") {
		const request = toDecisionRequest(batch);
		const requestQuestion = request.questions.find((q) => q.id === questionId);
		const choice: DecisionChoiceAnswer = {
			kind: "choice",
			questionId,
			value: answer.choice,
			probabilities: choiceProbabilities(answer, requestQuestion?.options),
			confidence: answer.confidence,
		};
		return choice;
	}
	return undefined;
}

export function buildDecisionResult(
	batch: AskDecisionArguments,
	classifier: Pick<ClassifierResult, "answers">,
): DecisionResult {
	const request = toDecisionRequest(batch);
	const answers: DecisionAnswer[] = [];
	for (const question of batch.questions) {
		const mapped = classifierAnswerToDecisionAnswer(batch, question.id, classifier.answers[question.id]);
		if (mapped) answers.push(mapped);
	}
	return {
		answers,
		request,
		...(request.goal ? { goal: request.goal } : {}),
	};
}

export function questionExpectsSkillHydration(question: AskDecisionArguments["questions"][number]): boolean {
	if (question.id === "skill" || question.id === "skills" || question.id === "skill_help") return true;
	return /skill/i.test(question.prompt);
}

export function batchRequestsSkillHelp(
	batch: AskDecisionArguments,
	answers: Record<string, ClassifierAnswer>,
): boolean {
	for (const question of batch.questions) {
		if (!questionExpectsSkillHydration(question)) continue;
		const answer = answers[question.id];
		if (!answer) continue;
		if (answer.type === "bool" && answer.probability >= 0.5) return true;
		if (answer.type === "choice") {
			const token = answer.choice.trim().toLowerCase();
			if (token !== "no" && token !== "none" && token !== "skip") return true;
		}
	}
	return false;
}

export function skillChoiceFromBatch(
	batch: AskDecisionArguments,
	answers: Record<string, ClassifierAnswer>,
): string | undefined {
	for (const question of batch.questions) {
		if (question.id !== "skill" && question.id !== "skills") continue;
		const answer = answers[question.id];
		if (answer?.type === "choice") return answer.choice;
	}
	return undefined;
}

export function skillQuestionKind(batch: AskDecisionArguments, questionId: string): "bool" | "choice" {
	const question = batch.questions.find((q) => q.id === questionId);
	return question ? decisionKindForQuestion(question) : "bool";
}
