import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ClassifierAnswer, ClassifierModel, ClassifierResult } from "@earendil-works/pi-ai";
import { summarizeClassifierAnswers } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../model-runtime.ts";
import type { Skill } from "../skills.ts";
import { batchRequestsSkillHelp, buildDecisionResult, skillChoiceFromBatch } from "./decision-result.ts";
import type { AskDecisionArguments } from "./questionnaire.ts";
import { toDecisionRequest } from "./questionnaire.ts";
import { pickSkillWithClassifier, renderSkillInjection } from "./skill-hydration.ts";
import { DECISION_REQUEST_MESSAGE_TYPE, DECISION_RESULT_MESSAGE_TYPE } from "./types.ts";

export async function buildDecisionTurnMessages(
	batch: AskDecisionArguments,
	answers: Record<string, ClassifierAnswer>,
	options: {
		skills: Skill[];
		modelRuntime: ModelRuntime;
		classifier?: ClassifierModel<any>;
		signal?: AbortSignal;
	},
): Promise<AgentMessage[]> {
	const request = toDecisionRequest(batch);
	const resultDetails = buildDecisionResult(batch, { answers });
	const messages: AgentMessage[] = [
		{
			role: "custom",
			customType: DECISION_REQUEST_MESSAGE_TYPE,
			content: `Decision request: ${request.questions.length} question(s)`,
			display: true,
			details: request,
			timestamp: Date.now(),
		},
		{
			role: "custom",
			customType: DECISION_RESULT_MESSAGE_TYPE,
			content: `Decision result: ${resultDetails.answers.length} answer(s)`,
			display: true,
			details: resultDetails,
			timestamp: Date.now(),
		},
		{
			role: "user",
			content: `<decision_results>\n${summarizeClassifierAnswers(batch, {
				answers,
				stopReason: "stop",
				api: "jev",
				provider: "decision-driven",
				model: "session",
				timestamp: Date.now(),
			} as ClassifierResult)}\n</decision_results>`,
			timestamp: Date.now(),
		},
	];

	if (batchRequestsSkillHelp(batch, answers)) {
		const explicitSkill = skillChoiceFromBatch(batch, answers);
		let skill = explicitSkill ? options.skills.find((entry) => entry.name === explicitSkill) : undefined;
		if (!skill && options.classifier) {
			skill = await pickSkillWithClassifier(
				options.skills,
				options.modelRuntime,
				options.classifier,
				options.signal,
			);
		}
		if (skill) {
			messages.push({
				role: "user",
				content: renderSkillInjection(skill),
				timestamp: Date.now(),
			});
		}
	}

	return messages;
}
