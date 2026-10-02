import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import type { ExtensionMode, ExtensionUIContext } from "../extensions/types.ts";
import { type AskDecisionArguments, decisionKindForQuestion } from "./questionnaire.ts";

export async function collectHumanPlanAnswers(
	batch: AskDecisionArguments,
	questionIds: string[],
	ui: ExtensionUIContext | undefined,
	mode: ExtensionMode,
): Promise<Record<string, ClassifierAnswer> | undefined> {
	if (questionIds.length === 0) return {};
	if (!ui || mode !== "tui") return undefined;

	const answers: Record<string, ClassifierAnswer> = {};
	for (const id of questionIds) {
		const question = batch.questions.find((entry) => entry.id === id);
		if (!question) continue;
		const kind = decisionKindForQuestion(question);
		if (kind === "bool") {
			const choice = await ui.select(question.prompt, ["Yes", "No"]);
			if (choice === undefined) return undefined;
			answers[id] = { type: "bool", probability: choice === "Yes" ? 0.99 : 0.01 };
			continue;
		}
		const labels = question.options?.map((option) => option.label) ?? [];
		if (labels.length === 0) return undefined;
		const selected = await ui.select(question.prompt, labels);
		if (selected === undefined) return undefined;
		const index = labels.indexOf(selected);
		const value = question.options?.[index]?.value ?? selected;
		answers[id] = {
			type: "choice",
			choice: value,
			confidence: 1,
			probabilities: { [value]: 1 },
		};
	}
	return answers;
}
