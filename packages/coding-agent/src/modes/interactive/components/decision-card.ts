import { Box, Text, visibleWidth } from "@earendil-works/pi-tui";
import {
	DECISION_REQUEST_MESSAGE_TYPE,
	DECISION_RESULT_MESSAGE_TYPE,
	type DecisionAnswer,
	type DecisionQuestion,
	type DecisionRequest,
	type DecisionResult,
	isDecisionRequest,
	isDecisionResult,
} from "../../../core/decision/types.ts";
import type { MessageRenderer } from "../../../core/extensions/types.ts";
import { type ThemeColor, theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

const BAR_WIDTH = 10;

function clampProbability(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function formatPercent(value: number): string {
	return `${Math.round(clampProbability(value) * 100)}%`.padStart(4);
}

function renderBar(value: number, color: ThemeColor): string {
	const filled = Math.round(clampProbability(value) * BAR_WIDTH);
	return theme.fg(color, "█".repeat(filled)) + theme.fg("dim", "░".repeat(BAR_WIDTH - filled));
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function renderTitle(suffix: string): string {
	return theme.fg("toolTitle", theme.bold("decision ")) + theme.fg("muted", suffix);
}

/** One row of an answer's probability breakdown. */
interface ScoreRow {
	label: string;
	probability: number;
	chosen: boolean;
}

interface AnswerView {
	id: string;
	prompt?: string;
	chosenLabel: string;
	chosenProbability: number;
	rows: ScoreRow[];
}

function buildAnswerView(answer: DecisionAnswer, question: DecisionQuestion | undefined): AnswerView {
	const id = answer.questionId;
	const prompt = question?.prompt;

	if (answer.kind === "bool") {
		const probability = clampProbability(answer.probability);
		const chosenLabel = answer.value ? "yes" : "no";
		return {
			id,
			prompt,
			chosenLabel,
			chosenProbability: answer.value ? probability : 1 - probability,
			rows: [
				{ label: "yes", probability, chosen: answer.value },
				{ label: "no", probability: 1 - probability, chosen: !answer.value },
			],
		};
	}

	const labels = new Map<string, string>();
	for (const option of question?.options ?? []) labels.set(option.value, option.label);
	const values = [...labels.keys()];
	for (const value of Object.keys(answer.probabilities)) {
		if (!labels.has(value)) values.push(value);
	}
	if (!values.includes(answer.value)) values.push(answer.value);

	const chosenProbability = clampProbability(answer.confidence ?? answer.probabilities[answer.value] ?? 0);
	return {
		id,
		prompt,
		chosenLabel: labels.get(answer.value) ?? answer.value,
		chosenProbability,
		rows: values.map((value) => ({
			label: labels.get(value) ?? value,
			probability: value === answer.value ? chosenProbability : (answer.probabilities[value] ?? 0),
			chosen: value === answer.value,
		})),
	};
}

/**
 * Renders a batch of decision questions the way a tool call is rendered: a title line, then each
 * question with its options. The goal is shown only when the request carries one.
 */
export class DecisionRequestCard extends Box {
	private request: DecisionRequest;

	constructor(request: DecisionRequest, outputPad = 1) {
		super(outputPad, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.request = request;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();
		const { questions, goal } = this.request;
		const lines = [renderTitle(plural(questions.length, "question"))];

		if (goal) lines.push(theme.fg("muted", "goal: ") + theme.fg("toolOutput", goal));

		questions.forEach((question, index) => {
			lines.push("");
			lines.push(`${theme.fg("accent", `${index + 1}. ${question.id}`)} ${theme.fg("toolOutput", question.prompt)}`);
			const choices =
				question.kind === "bool" ? "yes / no" : (question.options ?? []).map((option) => option.label).join(" / ");
			lines.push(theme.fg("dim", `   ${question.kind}: ${choices}`));
		});

		this.addChild(new Text(lines.join("\n"), 0, 0));
	}
}

/**
 * Renders classified answers. Collapsed: one line per question with the chosen answer and a compact
 * probability bar. Expanded: every option with its score. The goal score is shown only when provided.
 */
export class DecisionResultCard extends Box {
	private result: DecisionResult;
	private expanded = false;

	constructor(result: DecisionResult, outputPad = 1) {
		super(outputPad, 1, (text: string) => theme.bg("toolSuccessBg", text));
		this.result = result;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();
		const { answers, request, goal, onGoal } = this.result;
		const views = answers.map((answer) =>
			buildAnswerView(
				answer,
				request?.questions.find((question) => question.id === answer.questionId),
			),
		);

		let title = renderTitle(plural(answers.length, "answer"));
		if (!this.expanded) title += theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
		const lines = [title];

		const goalText = goal ?? request?.goal;
		if (this.expanded && goalText) lines.push(theme.fg("muted", "goal: ") + theme.fg("toolOutput", goalText));

		if (this.expanded) {
			for (const view of views) {
				lines.push("");
				lines.push(theme.fg("accent", view.id) + (view.prompt ? ` ${theme.fg("toolOutput", view.prompt)}` : ""));
				const labelWidth = Math.max(...view.rows.map((row) => visibleWidth(row.label)));
				for (const row of view.rows) {
					const marker = row.chosen ? theme.fg("success", ">") : " ";
					const label = row.label + " ".repeat(labelWidth - visibleWidth(row.label));
					const color: ThemeColor = row.chosen ? "success" : "muted";
					lines.push(
						` ${marker} ${theme.fg(row.chosen ? "text" : "muted", label)} ${renderBar(row.probability, color)} ${theme.fg(color, formatPercent(row.probability))}`,
					);
				}
			}
		} else {
			const idWidth = Math.max(0, ...views.map((view) => visibleWidth(view.id)));
			const answerWidth = Math.max(0, ...views.map((view) => visibleWidth(view.chosenLabel)));
			for (const view of views) {
				const id = view.id + " ".repeat(idWidth - visibleWidth(view.id));
				const answer = view.chosenLabel + " ".repeat(answerWidth - visibleWidth(view.chosenLabel));
				lines.push(
					`${theme.fg("accent", id)} ${theme.fg("text", answer)} ${renderBar(view.chosenProbability, "success")} ${theme.fg("success", formatPercent(view.chosenProbability))}`,
				);
			}
		}

		if (onGoal !== undefined) {
			if (this.expanded) lines.push("");
			lines.push(
				`${theme.fg("muted", "on goal ")}${renderBar(onGoal, "accent")} ${theme.fg("accent", formatPercent(onGoal))}`,
			);
		}

		this.addChild(new Text(lines.join("\n"), 0, 0));
	}
}

/**
 * Built-in renderers for the decision custom message types. Returns undefined for other types and
 * for messages whose details do not match the decision model, so the default rendering applies.
 */
export const decisionMessageRenderer: MessageRenderer = (message, options) => {
	if (message.customType === DECISION_REQUEST_MESSAGE_TYPE) {
		if (!isDecisionRequest(message.details)) return undefined;
		return new DecisionRequestCard(message.details, options.outputPad);
	}
	if (message.customType === DECISION_RESULT_MESSAGE_TYPE) {
		if (!isDecisionResult(message.details)) return undefined;
		const card = new DecisionResultCard(message.details, options.outputPad);
		card.setExpanded(options.expanded);
		return card;
	}
	return undefined;
};
