import type { SessionEntry } from "../session-manager.ts";

export const PLAN_MODE_ENTRY = "plan-mode";

export interface PlanModeState {
	enabled: boolean;
	todos?: Array<{ step: number; text: string; completed: boolean }>;
	executing?: boolean;
	toolsBeforePlanMode?: string[];
}

export function isPlanModeState(value: unknown): value is PlanModeState {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	if (typeof record.enabled !== "boolean") return false;
	if (record.executing !== undefined && typeof record.executing !== "boolean") return false;
	return true;
}

export function loadPlanModeFromBranch(branch: readonly SessionEntry[]): PlanModeState | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "custom" || entry.customType !== PLAN_MODE_ENTRY) continue;
		if (isPlanModeState(entry.data)) return entry.data;
	}
	return undefined;
}

/** Planning phase: read-only exploration, not executing steps yet. */
export function isPlanModePlanning(state: PlanModeState | undefined): boolean {
	return state?.enabled === true && state.executing !== true;
}
