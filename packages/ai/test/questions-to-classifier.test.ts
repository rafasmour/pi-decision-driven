import { describe, expect, it } from "vitest";
import type { ClassifierResult } from "../src/types.ts";
import { questionsToClassifierContext, summarizeClassifierAnswers } from "../src/utils/questions-to-classifier.ts";

describe("questionsToClassifierContext", () => {
	it("maps options to a choice question", () => {
		const context = questionsToClassifierContext({
			questions: [
				{
					id: "db",
					prompt: "Which database?",
					options: [
						{ value: "pg", label: "Postgres", description: "Relational" },
						{ value: "sqlite", label: "SQLite" },
					],
				},
			],
		});
		expect(context.questions.db).toEqual({
			type: "choice",
			instructions: "Which database?",
			criteria: { pg: "Postgres: Relational", sqlite: "SQLite" },
		});
	});

	it("defaults to a bool question when options are missing, and passes state through", () => {
		const context = questionsToClassifierContext({
			state: { file: "a.ts", n: 1, skipped: undefined },
			questions: [{ id: "ok", prompt: "Proceed?" }],
		});
		expect(context.state).toEqual({ file: "a.ts", n: 1 });
		expect(context.questions.ok).toEqual({
			type: "bool",
			instructions: "Proceed?",
			criteria: { true: "Yes", false: "No" },
		});
	});

	it("defaults state to an empty object", () => {
		expect(questionsToClassifierContext({ questions: [{ id: "a", prompt: "p" }] }).state).toEqual({});
	});

	it("maps empty options to a bool question", () => {
		const context = questionsToClassifierContext({ questions: [{ id: "a", prompt: "p", options: [] }] });
		expect(context.questions.a.type).toBe("bool");
	});

	it("detects a yes/no pair in either order and uses option labels", () => {
		const context = questionsToClassifierContext({
			questions: [
				{
					id: "a",
					prompt: "Delete it?",
					options: [
						{ value: "no", label: "Keep it" },
						{ value: "yes", label: "Delete it", description: "Irreversible" },
					],
				},
				{
					id: "b",
					prompt: "Enabled?",
					options: [
						{ value: "x", label: "True" },
						{ value: "y", label: "False." },
					],
				},
			],
		});
		expect(context.questions.a).toEqual({
			type: "bool",
			instructions: "Delete it?",
			criteria: { true: "Delete it: Irreversible", false: "Keep it" },
		});
		expect(context.questions.b).toEqual({
			type: "bool",
			instructions: "Enabled?",
			criteria: { true: "True", false: "False." },
		});
	});

	it("keeps two yes-only or non yes/no options as choice", () => {
		const context = questionsToClassifierContext({
			questions: [
				{
					id: "a",
					prompt: "p",
					options: [
						{ value: "yes", label: "Yes" },
						{ value: "yes2", label: "Yes please" },
					],
				},
				{
					id: "b",
					prompt: "p",
					options: [
						{ value: "yes", label: "Yes" },
						{ value: "no", label: "No" },
						{ value: "maybe", label: "Maybe" },
					],
				},
			],
		});
		expect(context.questions.a.type).toBe("choice");
		expect(context.questions.b.type).toBe("choice");
	});

	it("supports mixed batches", () => {
		const context = questionsToClassifierContext({
			questions: [
				{
					id: "c",
					prompt: "Pick",
					options: [
						{ value: "a", label: "A" },
						{ value: "b", label: "B" },
					],
				},
				{ id: "b", prompt: "Sure?" },
			],
		});
		expect(Object.keys(context.questions)).toEqual(["c", "b"]);
		expect(context.questions.c.type).toBe("choice");
		expect(context.questions.b.type).toBe("bool");
	});

	it("rejects an empty questions array", () => {
		expect(() => questionsToClassifierContext({ questions: [] })).toThrow(/at least one question/);
	});

	it("rejects duplicate ids", () => {
		expect(() =>
			questionsToClassifierContext({
				questions: [
					{ id: "a", prompt: "p" },
					{ id: "a", prompt: "q" },
				],
			}),
		).toThrow(/Duplicate question id "a"/);
	});

	it("rejects single-option questions and duplicate option values", () => {
		expect(() =>
			questionsToClassifierContext({ questions: [{ id: "a", prompt: "p", options: [{ value: "x", label: "X" }] }] }),
		).toThrow(/single option/);
		expect(() =>
			questionsToClassifierContext({
				questions: [
					{
						id: "a",
						prompt: "p",
						options: [
							{ value: "x", label: "X" },
							{ value: "x", label: "Y" },
						],
					},
				],
			}),
		).toThrow(/duplicate option value "x"/);
	});
});

describe("summarizeClassifierAnswers", () => {
	it("summarizes choice, bool, and missing answers", () => {
		const batch = {
			questions: [
				{
					id: "db",
					label: "Database",
					prompt: "p",
					options: [
						{ value: "pg", label: "Postgres" },
						{ value: "sqlite", label: "SQLite" },
					],
				},
				{ id: "ok", prompt: "p" },
				{ id: "missing", prompt: "p" },
			],
		};
		const result: ClassifierResult = {
			api: "test",
			provider: "test",
			model: "m",
			answers: {
				db: { type: "choice", choice: "pg", probabilities: { pg: 0.9, sqlite: 0.1 }, confidence: 0.9 },
				ok: { type: "bool", probability: 0.2 },
			},
			stopReason: "stop",
			timestamp: 0,
		};
		expect(summarizeClassifierAnswers(batch, result)).toBe(
			"Database: Postgres (90%)\nok: No (80%)\nmissing: (no answer)",
		);
	});
});
