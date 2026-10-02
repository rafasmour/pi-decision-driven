import type { ClassifierContext, JsonObject } from "@earendil-works/pi-ai";
import type { SessionEntry, SessionManager } from "../session-manager.ts";

/** Custom entry type for session-branch GoalCard state (GC2). */
export const GOAL_CARD_ENTRY = "pi.goal-card";

export interface GoalCardPlan {
	steps: string[];
	/** Number of leading steps marked complete. */
	completed?: number;
}

export interface GoalCard {
	goal: string;
	criteria?: string;
	plan?: GoalCardPlan;
	/** Last K intent summaries (not tool stdout). */
	recent: string[];
	/** When true, harness will not auto-refine except via explicit human edit. */
	frozen?: boolean;
}

export const GOAL_CARD_RECENT_CAP = 8;

const MAX_STATE_FIELD = 4_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isGoalCard(value: unknown): value is GoalCard {
	if (!isRecord(value) || typeof value.goal !== "string") return false;
	if (value.criteria !== undefined && typeof value.criteria !== "string") return false;
	if (value.frozen !== undefined && typeof value.frozen !== "boolean") return false;
	if (!Array.isArray(value.recent) || !value.recent.every((entry) => typeof entry === "string")) return false;
	if (value.plan !== undefined) {
		if (!isRecord(value.plan) || !Array.isArray(value.plan.steps)) return false;
		if (!value.plan.steps.every((step) => typeof step === "string")) return false;
		if (value.plan.completed !== undefined && typeof value.plan.completed !== "number") return false;
	}
	return true;
}

export function loadGoalCardFromBranch(branch: readonly SessionEntry[]): GoalCard | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "custom" || entry.customType !== GOAL_CARD_ENTRY) continue;
		if (isGoalCard(entry.data)) return entry.data;
	}
	return undefined;
}

export type GoalCardSessionWriter = Pick<SessionManager, "appendCustomEntry">;

export function persistGoalCard(sessionManager: GoalCardSessionWriter, card: GoalCard): void {
	sessionManager.appendCustomEntry(GOAL_CARD_ENTRY, card);
}

export function appendGoalCardRecent(card: GoalCard, summary: string): GoalCard {
	const trimmed = summary.trim();
	if (!trimmed) return card;
	const recent = [...card.recent, trimmed].slice(-GOAL_CARD_RECENT_CAP);
	return { ...card, recent };
}

export function capStateField(text: string, max = MAX_STATE_FIELD): string {
	if (text.length <= max) return text;
	return text.slice(0, max);
}

/** Compact GoalCard JSON for classifier state (never full transcript). */
export function goalCardClassifierState(card: GoalCard): JsonObject {
	const remainingSteps =
		card.plan?.steps.slice(card.plan.completed ?? 0).map((step) => capStateField(step, 512)) ?? [];
	return {
		goal: capStateField(card.goal, 512),
		...(card.criteria ? { criteria: capStateField(card.criteria, 512) } : {}),
		...(remainingSteps.length > 0 ? { plan_steps_remaining: remainingSteps } : {}),
		...(card.recent.length > 0 ? { recent_intents: card.recent.slice(-GOAL_CARD_RECENT_CAP) } : {}),
	};
}

export function mergeGoalCardState(context: ClassifierContext, card: GoalCard): ClassifierContext {
	return {
		...context,
		state: { ...context.state, goal_card: goalCardClassifierState(card) },
	};
}

export function emptyGoalCard(): GoalCard {
	return { goal: "", recent: [] };
}

export function remainingPlanSteps(card: GoalCard): string[] {
	if (!card.plan?.steps.length) return [];
	const completed = card.plan.completed ?? 0;
	return card.plan.steps.slice(completed);
}
