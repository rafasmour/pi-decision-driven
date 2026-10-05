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
	prompt: Type.String({
		description:
			"Full self-contained question text. Include every fact needed to answer (paths, choices, what was done). Never refer to prior questions or transcript context.",
	}),
	label: Type.Optional(Type.String({ description: "Optional short label" })),
	options: Type.Optional(
		Type.Array(optionSchema, {
			minItems: 2,
			description: "Omit entirely for yes/no. If present, must have at least 2 options (never exactly one).",
		}),
	),
});

const askDecisionSchema = Type.Object({
	questions: Type.Array(questionSchema, {
		minItems: 1,
		description:
			"One concern per question. Each prompt must be complete by itself. Options: omit for yes/no, or provide 2+ choices — never a single option.",
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
		"You must not freely decide or act: call ask_decision for every product, policy, or next-step choice before Act tools.",
		"Do not decide in your thought process — only describe the situation, then ask_decision.",
		"Until Act tools appear in the tool list, ask_decision is the only tool you may call — no read/explore/write/edit/bash.",
		"One concern per question. Construct each prompt as a complete problem: include paths, alternatives, and facts needed to answer without other questions or the transcript.",
		"The classifier only receives harness state (goal_card, user_request, recent_tools) — never assume transcript context.",
		"Options rule: omit options for yes/no; for multiple choice provide at least two { value, label } options. Never pass exactly one option.",
		"Keep state compact: optional verified facts only. The harness supplies goal, last user request, and recent tools.",
		"Human questionnaire appears only when the harness routes a preference/policy question to human — not as the default path in build mode.",
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
			"Pose one or more structured decisions for the harness. Each question must be self-contained (one complete concern). Omit options for yes/no, or provide 2+ options for multiple choice — never a single option. The harness routes each question to the classifier (jev) or a human questionnaire when preference/policy is required, then returns results as this tool's result — do not invent answers yourself.",
		promptSnippet: askDecisionToolSystemPromptContribution.snippet,
		promptGuidelines: [...askDecisionToolSystemPromptContribution.guidelines],
		parameters: askDecisionSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		renderCall: (args, theme, context) => {
			const questions = Array.isArray(args?.questions) ? args.questions : [];
			const title = `${theme.fg("toolTitle", theme.bold("ask_decision"))} ${theme.fg("muted", `${questions.length} question(s)`)}`;
			if (!context.expanded || questions.length === 0) {
				return new Text(title);
			}
			const lines = [title];
			for (const [index, question] of questions.entries()) {
				const id = typeof question?.id === "string" ? question.id : `q${index + 1}`;
				const prompt = typeof question?.prompt === "string" ? question.prompt : "";
				lines.push("");
				lines.push(`${theme.fg("accent", `${index + 1}. ${id}`)} ${theme.fg("toolOutput", prompt)}`);
				const options = Array.isArray(question?.options) ? question.options : undefined;
				if (!options || options.length === 0) {
					lines.push(theme.fg("dim", "   bool: yes / no"));
				} else {
					const labels = options
						.map((option) => (typeof option?.label === "string" ? option.label : String(option?.value ?? "")))
						.filter(Boolean);
					lines.push(theme.fg("dim", `   choice: ${labels.join(" / ")}`));
				}
			}
			return new Text(lines.join("\n"));
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
