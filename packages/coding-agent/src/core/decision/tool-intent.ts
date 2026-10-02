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

export function resolveToolIntentValue(raw: string): string | undefined {
	const token = normalizeIntentToken(raw);
	if (token === "respond") return "respond";
	return TOOL_INTENT_ALIASES[token] ?? (token.length > 0 ? token : undefined);
}

export function detectToolIntentFromAnswers(
	batch: AskDecisionArguments,
	answers: Record<string, ClassifierAnswer>,
): string | undefined {
	for (const question of batch.questions) {
		const answer = answers[question.id];
		if (!answer || answer.type !== "choice") continue;
		const isIntentQuestion =
			INTENT_QUESTION_IDS.includes(question.id) ||
			(question.options?.some((option) => resolveToolIntentValue(option.value) !== undefined) ?? false);
		if (!isIntentQuestion && !question.options?.length) continue;
		const resolved = resolveToolIntentValue(answer.choice);
		if (resolved) return resolved;
	}
	for (const question of batch.questions) {
		const answer = answers[question.id];
		if (answer?.type !== "choice") continue;
		const resolved = resolveToolIntentValue(answer.choice);
		if (resolved && resolved !== "respond") return resolved;
	}
	return undefined;
}

/** Restrict active tools to the intent family; `respond` clears restriction. */
export function toolNamesForIntent(intent: string, activeToolNames: readonly string[]): string[] | undefined {
	if (intent === "respond") return undefined;
	const family = resolveToolIntentValue(intent) ?? intent;
	if (family === "respond") return undefined;
	const allowed = new Set<string>([family]);
	if (family === "bash") allowed.add("bash");
	if (family === "read") {
		allowed.add("read");
		allowed.add("grep");
	}
	return activeToolNames.filter((name) => allowed.has(name));
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
