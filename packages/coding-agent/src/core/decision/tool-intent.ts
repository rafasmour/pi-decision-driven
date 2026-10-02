import { DECISION_TOOL_NAME } from "@earendil-works/pi-agent-core";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import type { AskDecisionArguments } from "./questionnaire.ts";

/** Values that authorize a single tool family for the next LLM turn (D1 tool_args). */
const TOOL_INTENT_ALIASES: Record<string, string> = {
	read: "read",
	search: "read",
	grep: "grep",
	bash: "bash",
	shell: "bash",
	terminal: "bash",
	edit: "edit",
	patch: "edit",
	write: "write",
	create: "write",
	respond: "respond",
	reply: "respond",
	answer: "respond",
};

const INTENT_QUESTION_IDS = ["intent", "action", "tool", "next", "approach"];

export function normalizeIntentToken(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Resolve a known tool-family alias only — product choice values must not become intents. */
export function resolveToolIntentValue(raw: string): string | undefined {
	return TOOL_INTENT_ALIASES[normalizeIntentToken(raw)];
}

function questionHasKnownToolOptions(question: AskDecisionArguments["questions"][number]): boolean {
	return question.options?.some((option) => resolveToolIntentValue(option.value) !== undefined) ?? false;
}

export function detectToolIntentFromAnswers(
	batch: AskDecisionArguments,
	answers: Record<string, ClassifierAnswer>,
): string | undefined {
	for (const question of batch.questions) {
		const answer = answers[question.id];
		if (!answer || answer.type !== "choice") continue;
		const isIntentQuestion = INTENT_QUESTION_IDS.includes(question.id) || questionHasKnownToolOptions(question);
		if (!isIntentQuestion) continue;
		const resolved = resolveToolIntentValue(answer.choice);
		if (resolved) return resolved;
	}
	return undefined;
}

/** Restrict active tools to the intent family; `respond` clears restriction. Always keeps ask_decision. */
export function toolNamesForIntent(intent: string, activeToolNames: readonly string[]): string[] | undefined {
	if (intent === "respond") return undefined;
	const family = resolveToolIntentValue(intent);
	if (!family || family === "respond") return undefined;
	const allowed = new Set<string>([family, DECISION_TOOL_NAME]);
	if (family === "bash") allowed.add("bash");
	if (family === "read") {
		allowed.add("read");
		allowed.add("grep");
	}
	const filtered = activeToolNames.filter((name) => allowed.has(name));
	// No matching Act tools in the active set → treat as no intent (lift pre-auth).
	if (!filtered.some((name) => name !== DECISION_TOOL_NAME)) return undefined;
	return filtered;
}

export function intentSummaryFromAnswers(
	batch: AskDecisionArguments,
	answers: Record<string, ClassifierAnswer>,
	intent: string | undefined,
): string {
	if (!intent) return "decision answered";
	const question = batch.questions.find((q) => answers[q.id]?.type === "choice");
	const answer = question ? answers[question.id] : undefined;
	if (answer?.type === "choice") {
		const label = question?.options?.find((option) => option.value === answer.choice)?.label ?? answer.choice;
		return `${question?.id ?? "intent"}: ${label}`;
	}
	return `intent: ${intent}`;
}
