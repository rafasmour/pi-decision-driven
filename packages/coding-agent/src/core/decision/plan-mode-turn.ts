import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ClassifierAnswer, ClassifierResult } from "@earendil-works/pi-ai";
import type { ExtensionMode, ExtensionUIContext } from "../extensions/types.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import type { Skill } from "../skills.ts";
import { resolveAnswererRoutedBatch } from "./answerer-routed-turn.ts";
import { buildDecisionTurnMessages } from "./decision-follow-up.ts";
import type { GoalCard } from "./goal-card.ts";
import {
	isReadyToDraftConfirmed,
	mergeClassifierAnswers,
	planDraftHarnessUserMessage,
	readyToDraftClassifierContext,
	splitPlanDecisionBatch,
} from "./plan-routing.ts";
import type { AskDecisionArguments, toClassifierContext } from "./questionnaire.ts";

export interface PlanModeClassifyHooks {
	classify: (
		context: ReturnType<typeof toClassifierContext>,
		signal?: AbortSignal,
	) => Promise<Pick<ClassifierResult, "answers" | "stopReason" | "errorMessage">>;
}

export type PlanModeTurnResult =
	| { status: "blocked" }
	| { status: "continue"; messages: AgentMessage[]; answers: Record<string, ClassifierAnswer> };

export async function resolvePlanModeDecisionTurn(
	batch: AskDecisionArguments,
	options: {
		goalCard: GoalCard;
		hooks: PlanModeClassifyHooks;
		ui: ExtensionUIContext | undefined;
		mode: ExtensionMode;
		skills: Skill[];
		modelRuntime: ModelRuntime;
		signal?: AbortSignal;
	},
): Promise<PlanModeTurnResult> {
	const { planning, hasReadyToDraft } = splitPlanDecisionBatch(batch);

	let routedAnswers: Record<string, ClassifierAnswer> = {};
	if (planning.questions.length > 0) {
		const routed = await resolveAnswererRoutedBatch(planning, {
			goalCard: options.goalCard,
			phase: "plan",
			hooks: options.hooks,
			ui: options.ui,
			mode: options.mode,
			signal: options.signal,
		});
		if (routed.status === "blocked") return { status: "blocked" };
		routedAnswers = routed.answers;
	}

	let readyAnswers: Record<string, ClassifierAnswer> = {};
	if (hasReadyToDraft) {
		const readyClassified = await options.hooks.classify(
			readyToDraftClassifierContext(batch, options.goalCard),
			options.signal,
		);
		if (readyClassified.stopReason !== "stop") return { status: "blocked" };
		readyAnswers = readyClassified.answers;
	}

	const mergedAnswers = mergeClassifierAnswers(routedAnswers, readyAnswers);
	const followUp = await buildDecisionTurnMessages(batch, mergedAnswers, {
		skills: options.skills,
		modelRuntime: options.modelRuntime,
		signal: options.signal,
	});

	if (hasReadyToDraft && isReadyToDraftConfirmed(mergedAnswers)) {
		followUp.push({
			role: "user",
			content: planDraftHarnessUserMessage(),
			timestamp: Date.now(),
		});
	}

	return { status: "continue", messages: followUp, answers: mergedAnswers };
}
