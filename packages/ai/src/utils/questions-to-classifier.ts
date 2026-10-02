import type {
	ClassifierBoolQuestion,
	ClassifierChoiceQuestion,
	ClassifierContext,
	ClassifierQuestion,
	ClassifierResult,
	JsonObject,
} from "../types.ts";

/** One selectable option of a questionnaire question. */
export interface QuestionnaireOption {
	value: string;
	label: string;
	description?: string;
}

/** One questionnaire question. `prompt` becomes the classifier instructions. */
export interface QuestionnaireQuestion {
	id: string;
	prompt: string;
	label?: string;
	options?: QuestionnaireOption[];
}

/** Questionnaire-shaped input for {@link questionsToClassifierContext}. */
export interface QuestionnaireBatch {
	state?: Record<string, unknown>;
	questions: QuestionnaireQuestion[];
}

const YES_TOKENS = new Set(["yes", "true"]);
const NO_TOKENS = new Set(["no", "false"]);

function normalizeToken(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[\s.!?]+$/u, "");
}

function optionPolarity(option: QuestionnaireOption): "yes" | "no" | undefined {
	for (const text of [option.value, option.label]) {
		const token = normalizeToken(text);
		if (YES_TOKENS.has(token)) return "yes";
		if (NO_TOKENS.has(token)) return "no";
	}
	return undefined;
}

function optionText(option: QuestionnaireOption): string {
	return option.description ? `${option.label}: ${option.description}` : option.label;
}

/** Returns the yes and no options when `options` is exactly a yes/no pair. */
function findYesNoPair(
	options: QuestionnaireOption[],
): { yes: QuestionnaireOption; no: QuestionnaireOption } | undefined {
	if (options.length !== 2) return undefined;
	const first = optionPolarity(options[0]);
	const second = optionPolarity(options[1]);
	if (first === "yes" && second === "no") return { yes: options[0], no: options[1] };
	if (first === "no" && second === "yes") return { yes: options[1], no: options[0] };
	return undefined;
}

function toJsonObject(state: Record<string, unknown> | undefined): JsonObject {
	if (state === undefined) return {};
	try {
		// JSON round-trip drops undefined/functions and rejects cycles and bigint.
		return JSON.parse(JSON.stringify(state)) as JsonObject;
	} catch (error) {
		throw new Error(`Questionnaire state must be JSON-serializable: ${(error as Error).message}`);
	}
}

function mapQuestion(question: QuestionnaireQuestion): ClassifierQuestion {
	const { id, prompt, options } = question;
	if (!options || options.length === 0) {
		return { type: "bool", instructions: prompt, criteria: { true: "Yes", false: "No" } };
	}
	if (options.length === 1) {
		throw new Error(`Question "${id}" has a single option; provide at least 2 options or none for yes/no`);
	}
	const seen = new Set<string>();
	for (const option of options) {
		if (seen.has(option.value)) {
			throw new Error(`Question "${id}" has duplicate option value "${option.value}"`);
		}
		seen.add(option.value);
	}

	const pair = findYesNoPair(options);
	if (pair) {
		const bool: ClassifierBoolQuestion = {
			type: "bool",
			instructions: prompt,
			criteria: { true: optionText(pair.yes), false: optionText(pair.no) },
		};
		return bool;
	}

	const criteria: Record<string, string> = {};
	for (const option of options) criteria[option.value] = optionText(option);
	const choice: ClassifierChoiceQuestion = { type: "choice", instructions: prompt, criteria };
	return choice;
}

/**
 * Map a questionnaire batch to a {@link ClassifierContext}.
 *
 * - No options, or exactly a yes/no pair: `bool` question.
 * - Two or more other options: `choice` question keyed by option value.
 *
 * Throws on an empty batch, empty or duplicate question ids, duplicate option values, and
 * single-option questions.
 */
export function questionsToClassifierContext(batch: QuestionnaireBatch): ClassifierContext {
	if (batch.questions.length === 0) {
		throw new Error("Questionnaire must contain at least one question");
	}
	const questions: Record<string, ClassifierQuestion> = {};
	for (const question of batch.questions) {
		if (question.id.length === 0) {
			throw new Error("Questionnaire question id must not be empty");
		}
		if (Object.hasOwn(questions, question.id)) {
			throw new Error(`Duplicate question id "${question.id}"`);
		}
		questions[question.id] = mapQuestion(question);
	}
	return { state: toJsonObject(batch.state), questions };
}

/**
 * Summarize classifier answers as plain text for a transcript, one line per question:
 * `<label or id>: <answer>`. Questions the classifier did not answer are marked `(no answer)`.
 */
export function summarizeClassifierAnswers(batch: QuestionnaireBatch, result: ClassifierResult): string {
	const lines: string[] = [];
	for (const question of batch.questions) {
		const name = question.label ?? question.id;
		const answer = result.answers[question.id];
		if (!answer) {
			lines.push(`${name}: (no answer)`);
		} else if (answer.type === "choice") {
			const option = question.options?.find((o) => o.value === answer.choice);
			lines.push(`${name}: ${option?.label ?? answer.choice} (${Math.round(answer.confidence * 100)}%)`);
		} else if (answer.type === "bool") {
			const value = answer.probability >= 0.5;
			const confidence = value ? answer.probability : 1 - answer.probability;
			lines.push(`${name}: ${value ? "Yes" : "No"} (${Math.round(confidence * 100)}%)`);
		} else {
			lines.push(`${name}: ${answer.score} (${Math.round(answer.confidence * 100)}%)`);
		}
	}
	return lines.join("\n");
}
