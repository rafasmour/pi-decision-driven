import { type AgentContext, type AgentTool, restoreMessagesToCheckpoint } from "@earendil-works/pi-agent-core";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import { buildDecisionResult } from "./decision-result.ts";
import type { QualityRoute } from "./quality-gate.ts";
import type { AskDecisionArguments } from "./questionnaire.ts";
import { toDecisionRequest } from "./questionnaire.ts";
import {
	DECISION_REQUEST_MESSAGE_TYPE,
	DECISION_RESULT_MESSAGE_TYPE,
	type DecisionRequest,
	type DecisionResult,
} from "./types.ts";

export interface DecisionGateRuntime {
	draftCheckpoint?: number;
	qualityRetriesUsed: number;
	/** Consecutive omit-and-retry attempts after failed tool calls (ask_decision validation, etc.). */
	toolFailureRetriesUsed: number;
	restrictedToolNames?: string[];
	respondAuthorized: boolean;
	/** End-of-act verify phase (ask_decision-only until settle or continue-fix). */
	verifying: boolean;
	/** Act-entry checkbox task list has been accepted for this authorization stretch. */
	actChecklistDone: boolean;
	/** Cap for forced verify harness continues when the model skips ask_decision. */
	verifyForceRetriesUsed: number;
}

export function createDecisionGateRuntime(): DecisionGateRuntime {
	return {
		qualityRetriesUsed: 0,
		toolFailureRetriesUsed: 0,
		respondAuthorized: false,
		verifying: false,
		actChecklistDone: false,
		verifyForceRetriesUsed: 0,
	};
}

export function applyToolRestriction(context: AgentContext, restrictedToolNames: string[] | undefined): AgentContext {
	if (!restrictedToolNames || restrictedToolNames.length === 0) return context;
	const allowed = new Set(restrictedToolNames);
	const tools = (context.tools ?? []).filter((tool: AgentTool) => allowed.has(tool.name));
	return { ...context, tools };
}

export function rollbackDraft(messages: AgentContext["messages"], checkpoint: number): void {
	restoreMessagesToCheckpoint(messages, checkpoint);
}

export function qualityGateDecisionMessages(
	batch: AskDecisionArguments,
	answers: Record<string, ClassifierAnswer>,
	goal: string | undefined,
	onGoal: number,
	_route: QualityRoute,
): DecisionResult {
	const result = buildDecisionResult(batch, { answers });
	return {
		...result,
		...(goal ? { goal } : {}),
		onGoal,
		request: {
			...(result.request ?? toDecisionRequest(batch)),
			goal: goal ?? result.request?.goal,
		},
	};
}

export function qualityGateCardMessages(
	batch: AskDecisionArguments,
	details: DecisionResult,
): Array<{
	role: "custom";
	customType: string;
	content: string;
	display: boolean;
	details: DecisionRequest | DecisionResult;
	timestamp: number;
}> {
	const request = toDecisionRequest(batch);
	return [
		{
			role: "custom",
			customType: DECISION_REQUEST_MESSAGE_TYPE,
			content: `Quality gate (${details.onGoal !== undefined ? "on goal" : "review"})`,
			display: true,
			details: request,
			timestamp: Date.now(),
		},
		{
			role: "custom",
			customType: DECISION_RESULT_MESSAGE_TYPE,
			content: `Quality gate: ${details.onGoal !== undefined ? `${Math.round(details.onGoal * 100)}% on goal` : "reviewed"}`,
			display: true,
			details,
			timestamp: Date.now(),
		},
	];
}
