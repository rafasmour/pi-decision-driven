import type { ClassifierAnswer } from "@earendil-works/pi-ai";

/**
 * Parse a yes/no classifier answer as continue-fix (yes) vs settle (no).
 * Returns undefined when the answer cannot be interpreted.
 */
export function parseVerifyContinueFixing(answer: ClassifierAnswer | undefined): boolean | undefined {
	if (!answer) return undefined;
	if (answer.type === "bool") return answer.probability >= 0.5;
	if (answer.type === "choice") {
		const choice = answer.choice.trim().toLowerCase();
		if (["yes", "y", "true", "continue", "fix", "repeat"].includes(choice)) return true;
		if (["no", "n", "false", "settle", "done", "finish"].includes(choice)) return false;
	}
	return undefined;
}

/** Pick the first interpretable yes/no from a classify answer map (verify batch). */
export function parseVerifyContinueFixingFromAnswers(answers: Record<string, ClassifierAnswer>): boolean | undefined {
	for (const answer of Object.values(answers)) {
		const parsed = parseVerifyContinueFixing(answer);
		if (parsed !== undefined) return parsed;
	}
	return undefined;
}

/**
 * Goal-clarity answer: true = clear (enter act), false = unclear (back to ask).
 */
export function parseGoalClarityClear(answer: ClassifierAnswer | undefined): boolean | undefined {
	if (!answer) return undefined;
	if (answer.type === "bool") return answer.probability >= 0.5;
	if (answer.type === "choice") {
		const choice = answer.choice.trim().toLowerCase();
		if (["yes", "y", "true", "clear"].includes(choice)) return true;
		if (["no", "n", "false", "unclear"].includes(choice)) return false;
	}
	return undefined;
}

export function parseGoalClarityFromAnswers(answers: Record<string, ClassifierAnswer>): boolean | undefined {
	const preferred = answers.goal_clear ?? answers.clear ?? answers.clarity;
	const fromPreferred = parseGoalClarityClear(preferred);
	if (fromPreferred !== undefined) return fromPreferred;
	for (const answer of Object.values(answers)) {
		const parsed = parseGoalClarityClear(answer);
		if (parsed !== undefined) return parsed;
	}
	return undefined;
}

export function verifyHarnessPrompt(): string {
	return [
		"<decision_harness>",
		"Act finished — enter verify before settling.",
		"Call ask_decision with one self-contained yes/no question:",
		'"Should we continue fixing / repeat before finishing?" (yes = keep fixing, no = settle).',
		"In the prompt: state the user goal, brief steps you executed, and honestly note any failures.",
		"</decision_harness>",
	].join("\n");
}

export function actChecklistHarnessPrompt(): string {
	return [
		"<decision_harness>",
		"Act phase: before other work, output a markdown checkbox task list of the work you will do",
		"(lines like `- [ ] …`). Then proceed with tools.",
		"</decision_harness>",
	].join("\n");
}

export function nudgeGoalClarityHarnessPrompt(): string {
	return [
		"<decision_harness>",
		"Nudge phase: goal is unclear. Call ask_decision with:",
		'(1) a question proposing the final goal text, and (2) id "goal_clear": "Is this goal clear enough to act?" (yes/no).',
		"If the decision model says the goal is unclear, Ask phase resumes.",
		"</decision_harness>",
	].join("\n");
}
