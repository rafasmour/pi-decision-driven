import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ClassifierAnswer, ClassifierResult } from "@earendil-works/pi-ai";
import type { ExtensionMode, ExtensionUIContext } from "../extensions/types.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import type { Skill } from "../skills.ts";
import { buildDecisionTurnMessages } from "./decision-follow-up.ts";
import type { GoalCard } from "./goal-card.ts";
import { collectHumanPlanAnswers } from "./plan-human.ts";
import {
	filterDecisionBatch,
	isReadyToDraftConfirmed,
	mergeClassifierAnswers,
	type PlanAnswerer,
	parseAnswererRouting,
	planAnswererRoutingContext,
	planDraftHarnessUserMessage,
	questionIdsForAnswerer,
	readyToDraftClassifierContext,
	routingAnswersForDisplay,
	splitPlanDecisionBatch,
} from "./plan-routing.ts";
import { type AskDecisionArguments, toClassifierContext } from "./questionnaire.ts";

export interface PlanModeClassifyHooks {
	classify: (
		context: ReturnType<typeof toClassifierContext>,
		signal?: AbortSignal,
	) => Promise<Pick<ClassifierResult, "answers" | "stopReason" | "errorMessage">>;
}

export type PlanModeTurnResult = { status: "blocked" } | { status: "continue"; messages: AgentMessage[] };

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

	let routing = new Map<string, PlanAnswerer>();
	let routingAnswers: Record<string, ClassifierAnswer> = {};
	if (planning.questions.length > 0) {
		const routingContext = planAnswererRoutingContext(planning, options.goalCard);
		const routingClassified = await options.hooks.classify(routingContext, options.signal);
		if (routingClassified.stopReason !== "stop") return { status: "blocked" };
		routing = parseAnswererRouting(planning, routingClassified.answers);
		routingAnswers = routingAnswersForDisplay(routing);
	}

	const jevIds = new Set(questionIdsForAnswerer(routing, "jev"));
	const humanIds = questionIdsForAnswerer(routing, "human");

	let jevAnswers: Record<string, ClassifierAnswer> = {};
	if (jevIds.size > 0) {
		const jevBatch = filterDecisionBatch(planning, jevIds);
		const jevClassified = await options.hooks.classify(toClassifierContext(jevBatch), options.signal);
		if (jevClassified.stopReason !== "stop") return { status: "blocked" };
		jevAnswers = jevClassified.answers;
	}

	const humanAnswers = await collectHumanPlanAnswers(planning, humanIds, options.ui, options.mode);
	if (humanAnswers === undefined) return { status: "blocked" };

	let readyAnswers: Record<string, ClassifierAnswer> = {};
	if (hasReadyToDraft) {
		const readyClassified = await options.hooks.classify(
			readyToDraftClassifierContext(batch, options.goalCard),
			options.signal,
		);
		if (readyClassified.stopReason !== "stop") return { status: "blocked" };
		readyAnswers = readyClassified.answers;
	}

	const mergedAnswers = mergeClassifierAnswers(routingAnswers, jevAnswers, humanAnswers, readyAnswers);
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

	return { status: "continue", messages: followUp };
}
