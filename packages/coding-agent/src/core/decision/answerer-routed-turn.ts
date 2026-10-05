import type { ClassifierAnswer, ClassifierResult } from "@earendil-works/pi-ai";
import type { ExtensionMode, ExtensionUIContext } from "../extensions/types.ts";
import type { GoalCard } from "./goal-card.ts";
import { collectHumanDecisionAnswers } from "./plan-human.ts";
import {
	type AnswererRoutingPhase,
	answererRoutingContext,
	type DecisionAnswerer,
	filterDecisionBatch,
	mergeClassifierAnswers,
	parseAnswererRouting,
	questionIdsForAnswerer,
	routingAnswersForDisplay,
} from "./plan-routing.ts";
import { type AskDecisionArguments, toClassifierContext } from "./questionnaire.ts";

export interface AnswererRoutedClassifyHooks {
	classify: (
		context: ReturnType<typeof toClassifierContext>,
		signal?: AbortSignal,
	) => Promise<Pick<ClassifierResult, "answers" | "stopReason" | "errorMessage">>;
}

export type AnswererRoutedBatchResult =
	| { status: "blocked" }
	| {
			status: "continue";
			answers: Record<string, ClassifierAnswer>;
			routing: Map<string, DecisionAnswerer>;
	  };

/**
 * Route each question to jev vs human, classify the jev subset, collect human answers, merge.
 * Used by plan-mode and build-mode ask_decision handling.
 */
export async function resolveAnswererRoutedBatch(
	batch: AskDecisionArguments,
	options: {
		goalCard: GoalCard;
		phase: AnswererRoutingPhase;
		hooks: AnswererRoutedClassifyHooks;
		ui: ExtensionUIContext | undefined;
		mode: ExtensionMode;
		signal?: AbortSignal;
		skipQuestionIds?: ReadonlySet<string>;
	},
): Promise<AnswererRoutedBatchResult> {
	if (batch.questions.length === 0) {
		return { status: "continue", answers: {}, routing: new Map() };
	}

	const routingContext = answererRoutingContext(batch, options.goalCard, {
		phase: options.phase,
		skipQuestionIds: options.skipQuestionIds,
	});
	if (Object.keys(routingContext.questions).length === 0) {
		return { status: "continue", answers: {}, routing: new Map() };
	}

	const routingClassified = await options.hooks.classify(routingContext, options.signal);
	if (routingClassified.stopReason !== "stop") return { status: "blocked" };
	const routing = parseAnswererRouting(batch, routingClassified.answers, {
		skipQuestionIds: options.skipQuestionIds,
	});
	const routingAnswers = routingAnswersForDisplay(routing);

	const jevIds = new Set(questionIdsForAnswerer(routing, "jev"));
	const humanIds = questionIdsForAnswerer(routing, "human");

	let jevAnswers: Record<string, ClassifierAnswer> = {};
	if (jevIds.size > 0) {
		const jevBatch = filterDecisionBatch(batch, jevIds);
		const jevClassified = await options.hooks.classify(toClassifierContext(jevBatch), options.signal);
		if (jevClassified.stopReason !== "stop") return { status: "blocked" };
		jevAnswers = jevClassified.answers;
	}

	const humanAnswers = await collectHumanDecisionAnswers(batch, humanIds, options.ui, options.mode);
	if (humanAnswers === undefined) return { status: "blocked" };

	return {
		status: "continue",
		answers: mergeClassifierAnswers(routingAnswers, jevAnswers, humanAnswers),
		routing,
	};
}
