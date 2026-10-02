import type { AgentTool } from "@earendil-works/pi-agent-core";
import { DECISION_TOOL_NAME } from "@earendil-works/pi-agent-core";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const optionSchema = Type.Object({
	value: Type.String({ description: "Machine-stable option id" }),
	label: Type.String({ description: "Human-readable option label" }),
	description: Type.Optional(Type.String({ description: "Optional longer option description" })),
});

const questionSchema = Type.Object({
	id: Type.String({ description: "Stable question id" }),
	prompt: Type.String({ description: "Question text shown to the classifier / user" }),
	label: Type.Optional(Type.String({ description: "Optional short label" })),
	options: Type.Optional(
		Type.Array(optionSchema, {
			description: "Omit for yes/no (bool). Include two or more options for multiple choice.",
		}),
	),
});

const askDecisionSchema = Type.Object({
	questions: Type.Array(questionSchema, {
		minItems: 1,
		description: "One or more choice or yes/no questions for the classifier",
	}),
	state: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Compact classifier state (goal, facts). Keep small; do not dump transcripts.",
		}),
	),
	goal: Type.Optional(Type.String({ description: "Optional goal string merged into classifier state" })),
});

export type AskDecisionToolInput = Static<typeof askDecisionSchema>;

export const askDecisionToolSystemPromptContribution = {
	snippet: "Ask the classifier a structured decision (yes/no or multiple choice)",
	guidelines: [
		"Call ask_decision when the next step depends on a choice; do not guess or implement in prose instead.",
		"Use yes/no questions (no options) or multiple-choice (options with value + label).",
		"Keep state compact: goal and verified facts only.",
	],
} as const;

/**
 * Reserved decision tool. In decision-driven mode the agent loop intercepts this call and never
 * runs execute; the stub exists so the model can declare the tool and so non-decision mode fails clearly.
 */
export function createAskDecisionToolDefinition(): ToolDefinition<typeof askDecisionSchema, undefined> {
	return {
		name: DECISION_TOOL_NAME,
		label: "ask_decision",
		description:
			"Pose one or more structured decisions for the harness classifier. Use yes/no questions (omit options) or multiple choice (provide options). The harness answers via the session classifier and returns results as this tool's result — do not invent answers yourself.",
		promptSnippet: askDecisionToolSystemPromptContribution.snippet,
		promptGuidelines: [...askDecisionToolSystemPromptContribution.guidelines],
		parameters: askDecisionSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		renderCall: (args, theme) => {
			const count = Array.isArray(args?.questions) ? args.questions.length : 0;
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ask_decision"))} ${theme.fg("muted", `${count} question(s)`)}`,
			);
		},
		async execute() {
			return {
				content: [
					{
						type: "text",
						text: "ask_decision is handled by the decision loop; execute should not run in decision-driven mode.",
					},
				],
				details: undefined,
			};
		},
	};
}

export function createAskDecisionTool(): AgentTool<typeof askDecisionSchema> {
	return wrapToolDefinition(createAskDecisionToolDefinition());
}
