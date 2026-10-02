/**
 * Decision cards demo.
 *
 * Interactive mode renders custom messages of type "decision-request" and "decision-result" as
 * decision cards. This extension sends fixture data so the cards can be seen before the agent
 * produces decisions itself.
 *
 * Usage: /decision-demo [choice|bool|mixed]   (default: mixed)
 * Toggle the tool output expansion key (ctrl+o by default) to see full scores on result cards.
 */

import type {
	DecisionAnswer,
	DecisionQuestion,
	DecisionRequest,
	DecisionResult,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const choiceQuestion: DecisionQuestion = {
	id: "database",
	prompt: "Which database fits this service?",
	kind: "choice",
	options: [
		{ value: "pg", label: "Postgres" },
		{ value: "sqlite", label: "SQLite" },
		{ value: "mysql", label: "MySQL" },
	],
};

const boolQuestion: DecisionQuestion = {
	id: "migrate",
	prompt: "Does the change need a data migration?",
	kind: "bool",
};

const choiceAnswer: DecisionAnswer = {
	kind: "choice",
	questionId: "database",
	value: "pg",
	probabilities: { pg: 0.82, sqlite: 0.15, mysql: 0.03 },
};

const boolAnswer: DecisionAnswer = { kind: "bool", questionId: "migrate", value: true, probability: 0.71 };

const fixtures: Record<string, { request: DecisionRequest; answers: DecisionAnswer[] }> = {
	choice: { request: { questions: [choiceQuestion] }, answers: [choiceAnswer] },
	bool: { request: { questions: [boolQuestion] }, answers: [boolAnswer] },
	mixed: {
		request: { questions: [choiceQuestion, boolQuestion], goal: "Ship the storage layer without downtime" },
		answers: [choiceAnswer, boolAnswer],
	},
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("decision-demo", {
		description: "Show decision request and result cards (usage: /decision-demo [choice|bool|mixed])",
		handler: async (args, ctx) => {
			const name = args.trim() || "mixed";
			const fixture = fixtures[name];
			if (!fixture) {
				ctx.ui.notify(`Unknown fixture "${name}". Use choice, bool, or mixed.`, "warning");
				return;
			}

			const result: DecisionResult = {
				answers: fixture.answers,
				request: fixture.request,
				...(fixture.request.goal ? { goal: fixture.request.goal, onGoal: 0.9 } : {}),
			};

			pi.sendMessage({
				customType: "decision-request",
				content: `Decision request: ${fixture.request.questions.length} question(s)`,
				display: true,
				details: fixture.request,
			});
			pi.sendMessage({
				customType: "decision-result",
				content: `Decision result: ${fixture.answers.length} answer(s)`,
				display: true,
				details: result,
			});
		},
	});
}
