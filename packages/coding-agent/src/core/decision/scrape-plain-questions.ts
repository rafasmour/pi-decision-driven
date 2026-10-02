import type { AskDecisionArguments } from "./questionnaire.ts";
import { parseAskDecisionArguments } from "./questionnaire.ts";

const NUMBERED_QUESTION = /^\s*(?:\d+[.)]|[-*•])\s+(.+\?)\s*$/;
const LETTERED_OPTION = /^\s*(?:[A-Za-z]|[0-9]+)[.)]\s+(.+?)\s*$/;
const BARE_QUESTION = /([^.!?\n]{3,}\?)/g;

function slugifyId(prompt: string, used: Set<string>): string {
	const base =
		prompt
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.slice(0, 40) || "q";
	let id = base;
	let n = 2;
	while (used.has(id)) {
		id = `${base}_${n}`;
		n++;
	}
	used.add(id);
	return id;
}

function optionValue(label: string, index: number): string {
	const token = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 24);
	return token || `opt_${index + 1}`;
}

/** Silent fallback when the model still dumps a questionnaire JSON object (not preferred). */
export function tryParseQuestionnaireJson(text: string): AskDecisionArguments | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		return parseAskDecisionArguments(JSON.parse(trimmed) as Record<string, unknown>);
	} catch {
		return undefined;
	}
}

/**
 * Scrape plain-text assistant questions into a questionnaire batch for the classifier.
 * Returns undefined when the turn does not look like a question turn.
 */
export function scrapePlainQuestionsFromText(
	text: string,
	state?: Record<string, unknown>,
): AskDecisionArguments | undefined {
	const fromJson = tryParseQuestionnaireJson(text);
	if (fromJson) {
		if (state && Object.keys(state).length > 0) {
			return { ...fromJson, state: { ...state, ...(fromJson.state ?? {}) } };
		}
		return fromJson;
	}

	const trimmed = text.trim();
	if (!trimmed) return undefined;

	const lines = trimmed.split(/\r?\n/);
	const usedIds = new Set<string>();
	const questions: AskDecisionArguments["questions"] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const numbered = NUMBERED_QUESTION.exec(line);
		if (numbered) {
			const prompt = numbered[1].trim();
			const options: Array<{ value: string; label: string }> = [];
			let j = i + 1;
			while (j < lines.length) {
				const next = (lines[j] ?? "").trim();
				if (!next) {
					j++;
					continue;
				}
				if (NUMBERED_QUESTION.test(next) || next.endsWith("?")) break;
				const opt = LETTERED_OPTION.exec(next);
				if (!opt) break;
				const label = opt[1].trim();
				options.push({ value: optionValue(label, options.length), label });
				j++;
			}
			if (options.length >= 2) {
				questions.push({ id: slugifyId(prompt, usedIds), prompt, options });
				i = j - 1;
				continue;
			}
			questions.push({ id: slugifyId(prompt, usedIds), prompt });
			continue;
		}

		if (line.trim().endsWith("?") && line.trim().length > 3 && !LETTERED_OPTION.test(line.trim())) {
			const prompt = line.trim();
			if (!questions.some((q) => q.prompt === prompt)) {
				questions.push({ id: slugifyId(prompt, usedIds), prompt });
			}
		}
	}

	if (questions.length === 0) {
		const matches = trimmed.match(BARE_QUESTION) ?? [];
		for (const raw of matches) {
			const prompt = raw.trim();
			if (prompt.length < 4) continue;
			if (questions.some((q) => q.prompt === prompt)) continue;
			questions.push({ id: slugifyId(prompt, usedIds), prompt });
		}
	}

	if (questions.length === 0) return undefined;
	return {
		questions,
		...(state && Object.keys(state).length > 0 ? { state } : {}),
	};
}
