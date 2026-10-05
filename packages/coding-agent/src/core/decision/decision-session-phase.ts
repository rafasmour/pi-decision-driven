import { emptyGoalCard, type GoalCard } from "./goal-card.ts";

/** Harness-facing decision session phase (not agent-core classify DecisionPhase). */
export type DecisionSessionPhase = "ask" | "nudge" | "act" | "verify";

export const GOAL_CLARITY_MIN_CHARS = 8;

export function isGoalClear(goalCard: GoalCard | undefined): boolean {
	return (goalCard ?? emptyGoalCard()).goal.trim().length >= GOAL_CLARITY_MIN_CHARS;
}

export interface ResolveDecisionSessionPhaseInput {
	decisionDriven: boolean;
	respondAuthorized: boolean;
	verifying: boolean;
	goalCard?: GoalCard;
}

/** Resolve ask / nudge / act / verify from gate + GoalCard state. */
export function resolveDecisionSessionPhase(input: ResolveDecisionSessionPhaseInput): DecisionSessionPhase | undefined {
	if (!input.decisionDriven) return undefined;
	if (input.verifying) return "verify";
	if (!input.respondAuthorized) return "ask";
	if (!isGoalClear(input.goalCard)) return "nudge";
	return "act";
}

/** True when ask_decision-only lockdown applies (ask or verify). */
export function isAskDecisionOnlyPhase(phase: DecisionSessionPhase | undefined): boolean {
	return phase === "ask" || phase === "verify";
}

/** True when a phase-specific `<decision_loop>` section should be injected. */
export function shouldInjectDecisionLoop(phase: DecisionSessionPhase | undefined): boolean {
	return phase === "ask" || phase === "nudge" || phase === "act" || phase === "verify";
}
