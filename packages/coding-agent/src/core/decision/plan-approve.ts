import type { ExtensionUIContext } from "../extensions/types.ts";
import type { GoalCard } from "./goal-card.ts";
import type { PlanTodoItem } from "./plan-steps.ts";

export function goalCardWithPlanSteps(card: GoalCard, todos: PlanTodoItem[]): GoalCard {
	return {
		...card,
		plan: {
			steps: todos.map((item) => item.text),
			completed: 0,
		},
		frozen: true,
	};
}

/** GC2: optional human edit of goal/criteria before build handoff. */
export async function editGoalCardAtPlanApprove(ui: ExtensionUIContext, card: GoalCard): Promise<GoalCard | undefined> {
	const goalPrefill = card.goal.trim();
	const goal = await ui.editor("Goal (GC2):", goalPrefill);
	if (goal === undefined) return undefined;
	const criteriaPrefill = card.criteria?.trim() ?? "";
	const criteria = await ui.editor("Success criteria (optional):", criteriaPrefill);
	if (criteria === undefined) return undefined;
	return {
		...card,
		goal: goal.trim() || goalPrefill,
		...(criteria.trim() ? { criteria: criteria.trim() } : {}),
		frozen: true,
	};
}
