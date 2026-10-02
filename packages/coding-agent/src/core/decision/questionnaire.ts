import type { ClassifierContext, ClassifierQuestion } from "@earendil-works/pi-ai";
import {
	type QuestionnaireOption,
	type QuestionnaireQuestion,
	questionsToClassifierContext,
} from "@earendil-works/pi-ai";
import type { DecisionOption, DecisionQuestion, DecisionRequest } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQuestionnaireOption(value: unknown): value is QuestionnaireOption {
	return (
		isRecord(value) &&
		typeof value.value === "string" &&
		typeof value.label === "string" &&
		(value.description === undefined || typeof value.description === "string")
	);
}

function isQuestionnaireQuestion(value: unknown): value is QuestionnaireQuestion {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.prompt !== "string") return false;
	if (value.label !== undefined && typeof value.label !== "string") return false;
	if (value.options === undefined) return true;
	return Array.isArray(value.options) && value.options.every(isQuestionnaireOption);
}

/** Parsed decision batch (```decisions``` block or legacy tool args) in questionnaire shape. */
export interface AskDecisionArguments {
	state?: Record<string, unknown>;
	questions: QuestionnaireQuestion[];
	goal?: string;
}

export function isQuestionnaireBatch(value: unknown): value is AskDecisionArguments {
	if (!isRecord(value) || !Array.isArray(value.questions)) return false;
	if (value.goal !== undefined && typeof value.goal !== "string") return false;
	if (value.state !== undefined && !isRecord(value.state)) return false;
	return value.questions.length > 0 && value.questions.every(isQuestionnaireQuestion);
}

export function parseAskDecisionArguments(args: Record<string, unknown>): AskDecisionArguments | undefined {
	if (!isQuestionnaireBatch(args)) return undefined;
	return {
		state: args.state,
		questions: args.questions,
		goal: args.goal,
	};
}

export function toClassifierContext(batch: AskDecisionArguments): ClassifierContext {
	return questionsToClassifierContext({
		state: batch.state,
		questions: batch.questions,
	});
}

export function isClassifierQuestionRecord(value: unknown): value is Record<string, ClassifierQuestion> {
	return isRecord(value) && !Array.isArray(value) && Object.keys(value).length > 0;
}

export function decisionKindForQuestion(question: QuestionnaireQuestion): "bool" | "choice" {
	if (!question.options || question.options.length === 0) return "bool";
	return "choice";
}

export function toDecisionRequest(batch: AskDecisionArguments): DecisionRequest {
	const questions: DecisionQuestion[] = batch.questions.map((question) => {
		const kind = decisionKindForQuestion(question);
		if (kind === "bool") {
			return { id: question.id, prompt: question.prompt, kind: "bool" };
		}
		const options: DecisionOption[] = question.options!.map((option) => ({
			value: option.value,
			label: option.label,
		}));
		return { id: question.id, prompt: question.prompt, kind: "choice", options };
	});
	return {
		questions,
		...(batch.goal ? { goal: batch.goal } : {}),
	};
}
