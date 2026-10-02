/**
 * Data model for decision cards.
 *
 * A decision request is a batch of questions the agent wants classified. A decision result carries
 * one answer per question with the probabilities behind it. Both travel as `details` of custom
 * messages with the types below and are rendered by the interactive decision cards.
 */

/** Custom message type for a batch of decision questions. `details` is a {@link DecisionRequest}. */
export const DECISION_REQUEST_MESSAGE_TYPE = "decision-request";

/** Custom message type for classified answers. `details` is a {@link DecisionResult}. */
export const DECISION_RESULT_MESSAGE_TYPE = "decision-result";

export interface DecisionOption {
	value: string;
	label: string;
}

export interface DecisionQuestion {
	id: string;
	prompt: string;
	kind: "choice" | "bool";
	/** Required for `choice` questions, ignored for `bool` questions. */
	options?: DecisionOption[];
}

export interface DecisionRequest {
	questions: DecisionQuestion[];
	/** Goal snippet. The card shows it only when provided. */
	goal?: string;
}

export interface DecisionChoiceAnswer {
	kind: "choice";
	questionId: string;
	/** Value of the chosen option. */
	value: string;
	/** Probability per option value. Values are in [0, 1]. */
	probabilities: Record<string, number>;
	/** Confidence in the chosen option. Defaults to `probabilities[value]`. */
	confidence?: number;
}

export interface DecisionBoolAnswer {
	kind: "bool";
	questionId: string;
	value: boolean;
	/** Probability that the answer is true, in [0, 1]. */
	probability: number;
}

export type DecisionAnswer = DecisionChoiceAnswer | DecisionBoolAnswer;

export interface DecisionResult {
	answers: DecisionAnswer[];
	/** Request these answers belong to. Used for prompts and option labels. */
	request?: DecisionRequest;
	/** Goal snippet. The card shows it only when provided. */
	goal?: string;
	/** How well the goal is met, in [0, 1]. The card shows it only when provided. */
	onGoal?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isDecisionQuestion(value: unknown): value is DecisionQuestion {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || typeof value.prompt !== "string") return false;
	if (value.kind === "bool") return true;
	if (value.kind !== "choice" || !Array.isArray(value.options)) return false;
	return value.options.every((o) => isRecord(o) && typeof o.value === "string" && typeof o.label === "string");
}

export function isDecisionRequest(value: unknown): value is DecisionRequest {
	if (!isRecord(value) || !Array.isArray(value.questions)) return false;
	if (value.goal !== undefined && typeof value.goal !== "string") return false;
	return value.questions.every(isDecisionQuestion);
}

function isDecisionAnswer(value: unknown): value is DecisionAnswer {
	if (!isRecord(value) || typeof value.questionId !== "string") return false;
	if (value.kind === "bool") return typeof value.value === "boolean" && typeof value.probability === "number";
	if (value.kind !== "choice") return false;
	return (
		typeof value.value === "string" &&
		isRecord(value.probabilities) &&
		(value.confidence === undefined || typeof value.confidence === "number")
	);
}

export function isDecisionResult(value: unknown): value is DecisionResult {
	if (!isRecord(value) || !Array.isArray(value.answers)) return false;
	if (value.request !== undefined && !isDecisionRequest(value.request)) return false;
	if (value.goal !== undefined && typeof value.goal !== "string") return false;
	if (value.onGoal !== undefined && typeof value.onGoal !== "number") return false;
	return value.answers.every(isDecisionAnswer);
}
