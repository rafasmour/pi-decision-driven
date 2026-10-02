import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import {
	DECISION_REQUEST_MESSAGE_TYPE,
	DECISION_RESULT_MESSAGE_TYPE,
	type DecisionRequest,
	type DecisionResult,
} from "../src/core/decision/types.ts";
import type { CustomMessage } from "../src/core/messages.ts";
import { CustomMessageComponent } from "../src/modes/interactive/components/custom-message.ts";
import {
	DecisionRequestCard,
	DecisionResultCard,
	decisionMessageRenderer,
} from "../src/modes/interactive/components/decision-card.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

const ANSI = /\x1b\[[0-9;]*m/g;

function plain(lines: string[]): string[] {
	return lines.map((line) => line.replace(ANSI, "").trimEnd());
}

const choiceRequest: DecisionRequest = {
	questions: [
		{
			id: "database",
			prompt: "Which database?",
			kind: "choice",
			options: [
				{ value: "pg", label: "Postgres" },
				{ value: "sqlite", label: "SQLite" },
			],
		},
	],
};

const boolRequest: DecisionRequest = {
	questions: [{ id: "migrate", prompt: "Needs a migration?", kind: "bool" }],
};

const mixedRequest: DecisionRequest = {
	questions: [...choiceRequest.questions, ...boolRequest.questions],
	goal: "Ship without downtime",
};

const mixedResult: DecisionResult = {
	request: mixedRequest,
	answers: [
		{ kind: "choice", questionId: "database", value: "pg", probabilities: { pg: 0.8, sqlite: 0.2 } },
		{ kind: "bool", questionId: "migrate", value: false, probability: 0.3 },
	],
};

beforeAll(() => {
	initTheme("dark");
});

describe("DecisionRequestCard", () => {
	it("renders a choice question with its options", () => {
		const lines = plain(new DecisionRequestCard(choiceRequest).render(80));
		expect(lines.some((l) => l.includes("decision") && l.includes("1 question"))).toBe(true);
		expect(lines.some((l) => l.includes("1. database") && l.includes("Which database?"))).toBe(true);
		expect(lines.some((l) => l.includes("choice: Postgres / SQLite"))).toBe(true);
		expect(lines.some((l) => l.includes("goal:"))).toBe(false);
	});

	it("renders a bool question", () => {
		const lines = plain(new DecisionRequestCard(boolRequest).render(80));
		expect(lines.some((l) => l.includes("1. migrate") && l.includes("Needs a migration?"))).toBe(true);
		expect(lines.some((l) => l.includes("bool: yes / no"))).toBe(true);
	});

	it("renders mixed questions and the goal when provided", () => {
		const lines = plain(new DecisionRequestCard(mixedRequest).render(80));
		expect(lines.some((l) => l.includes("2 questions"))).toBe(true);
		expect(lines.some((l) => l.includes("goal: Ship without downtime"))).toBe(true);
		expect(lines.some((l) => l.includes("2. migrate"))).toBe(true);
	});
});

describe("DecisionResultCard", () => {
	it("collapses choice answers to the chosen option and its bar", () => {
		const card = new DecisionResultCard({
			request: choiceRequest,
			answers: [{ kind: "choice", questionId: "database", value: "pg", probabilities: { pg: 0.82, sqlite: 0.18 } }],
		});
		const lines = plain(card.render(80));
		expect(lines.some((l) => l.includes("1 answer") && l.includes("to expand"))).toBe(true);
		expect(lines.some((l) => l.includes("database") && l.includes("Postgres") && l.includes("82%"))).toBe(true);
		expect(lines.some((l) => l.includes("SQLite"))).toBe(false);
	});

	it("uses explicit confidence over the option probability", () => {
		const card = new DecisionResultCard({
			request: choiceRequest,
			answers: [
				{
					kind: "choice",
					questionId: "database",
					value: "pg",
					probabilities: { pg: 0.5, sqlite: 0.5 },
					confidence: 0.9,
				},
			],
		});
		expect(plain(card.render(80)).some((l) => l.includes("90%"))).toBe(true);
	});

	it("shows the probability of the chosen bool answer", () => {
		const card = new DecisionResultCard({
			answers: [{ kind: "bool", questionId: "migrate", value: false, probability: 0.3 }],
		});
		const lines = plain(card.render(80));
		expect(lines.some((l) => l.includes("migrate") && l.includes("no") && l.includes("70%"))).toBe(true);
	});

	it("expands to every option with its score", () => {
		const card = new DecisionResultCard(mixedResult);
		card.setExpanded(true);
		const lines = plain(card.render(80));
		expect(lines.some((l) => l.includes("to expand"))).toBe(false);
		expect(lines.some((l) => l.includes("database") && l.includes("Which database?"))).toBe(true);
		expect(lines.some((l) => l.includes("> Postgres") && l.includes("80%"))).toBe(true);
		expect(lines.some((l) => l.includes("SQLite") && l.includes("20%"))).toBe(true);
		expect(lines.some((l) => l.includes("> no") && l.includes("70%"))).toBe(true);
		expect(lines.some((l) => l.includes("yes") && l.includes("30%"))).toBe(true);
		expect(lines.some((l) => l.includes("goal: Ship without downtime"))).toBe(true);
	});

	it("shows the goal score only when provided", () => {
		expect(plain(new DecisionResultCard(mixedResult).render(80)).some((l) => l.includes("on goal"))).toBe(false);
		const withGoal = new DecisionResultCard({ ...mixedResult, onGoal: 0.9 });
		expect(plain(withGoal.render(80)).some((l) => l.includes("on goal") && l.includes("90%"))).toBe(true);
	});

	it("falls back to raw values without a request and clamps probabilities", () => {
		const card = new DecisionResultCard({
			answers: [{ kind: "choice", questionId: "q", value: "a", probabilities: { a: 1.4, b: Number.NaN } }],
		});
		card.setExpanded(true);
		const lines = plain(card.render(80));
		expect(lines.some((l) => l.includes("> a") && l.includes("100%"))).toBe(true);
		expect(lines.some((l) => l.includes("b") && l.includes("0%"))).toBe(true);
	});

	it("keeps every line within the render width", () => {
		const card = new DecisionResultCard(mixedResult);
		for (const expanded of [false, true]) {
			card.setExpanded(expanded);
			for (const line of card.render(30)) expect(visibleWidth(line)).toBeLessThanOrEqual(30);
		}
	});
});

describe("decision message rendering", () => {
	function message(customType: string, details: unknown): CustomMessage<unknown> {
		return { role: "custom", customType, content: "fallback", display: true, details, timestamp: 0 };
	}

	it("renders decision custom messages without an extension renderer", () => {
		const request = new CustomMessageComponent(message(DECISION_REQUEST_MESSAGE_TYPE, mixedRequest));
		expect(plain(request.render(80)).some((l) => l.includes("2 questions"))).toBe(true);

		const result = new CustomMessageComponent(message(DECISION_RESULT_MESSAGE_TYPE, mixedResult));
		expect(plain(result.render(80)).some((l) => l.includes("Postgres") && l.includes("80%"))).toBe(true);
		result.setExpanded(true);
		expect(plain(result.render(80)).some((l) => l.includes("SQLite") && l.includes("20%"))).toBe(true);
	});

	it("falls back to default rendering when details are malformed", () => {
		expect(
			decisionMessageRenderer(
				message(DECISION_RESULT_MESSAGE_TYPE, { answers: "nope" }),
				{
					expanded: false,
					outputPad: 1,
				},
				theme,
			),
		).toBeUndefined();

		const component = new CustomMessageComponent(message(DECISION_RESULT_MESSAGE_TYPE, { answers: "nope" }));
		const lines = plain(component.render(80));
		expect(lines.some((l) => l.includes("[decision-result]"))).toBe(true);
		expect(lines.some((l) => l.includes("fallback"))).toBe(true);
	});

	it("ignores other custom message types", () => {
		const component = new CustomMessageComponent(message("other", mixedResult));
		expect(plain(component.render(80)).some((l) => l.includes("[other]"))).toBe(true);
	});
});
