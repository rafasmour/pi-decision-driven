/**
 * Built-in decision-driven plan mode: read-only exploration, ```decisions``` clarifications,
 * execute/refine handoff with GoalCard plan steps.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import { Key } from "@earendil-works/pi-tui";
import { emptyGoalCard, GOAL_CARD_ENTRY, loadGoalCardFromBranch } from "../../core/decision/goal-card.ts";
import { editGoalCardAtPlanApprove, goalCardWithPlanSteps } from "../../core/decision/plan-approve.ts";
import { PLAN_MODE_ENTRY, type PlanModeState } from "../../core/decision/plan-mode-state.ts";
import {
	extractPlanTodoItems,
	isSafePlanModeBashCommand,
	markCompletedPlanSteps,
	type PlanTodoItem,
} from "../../core/decision/plan-steps.ts";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "../../core/extensions/types.ts";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export function createPlanModeExtension(): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		let planModeEnabled = false;
		let executionMode = false;
		let todoItems: PlanTodoItem[] = [];
		let toolsBeforePlanMode: string[] | undefined;

		pi.registerFlag("plan", {
			description: "Start in plan mode (read-only exploration)",
			type: "boolean",
			default: false,
		});

		function updateStatus(ctx: ExtensionContext): void {
			if (executionMode && todoItems.length > 0) {
				const completed = todoItems.filter((item) => item.completed).length;
				ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
			} else if (planModeEnabled) {
				ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
			} else {
				ctx.ui.setStatus("plan-mode", undefined);
			}

			if (executionMode && todoItems.length > 0) {
				const lines = todoItems.map((item) => {
					if (item.completed) {
						return (
							ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
						);
					}
					return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
				});
				ctx.ui.setWidget("plan-todos", lines);
			} else {
				ctx.ui.setWidget("plan-todos", undefined);
			}
		}

		function uniqueToolNames(toolNames: string[]): string[] {
			return [...new Set(toolNames)];
		}

		function getPlanModeTools(activeToolNames: string[]): string[] {
			return uniqueToolNames([
				...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
				...PLAN_MODE_TOOLS,
			]);
		}

		function getNormalModeTools(activeToolNames: string[]): string[] {
			return uniqueToolNames([
				...NORMAL_MODE_TOOLS,
				...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
			]);
		}

		function enablePlanModeTools(): void {
			if (toolsBeforePlanMode === undefined) {
				toolsBeforePlanMode = pi.getActiveTools();
			}
			pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
		}

		function restoreNormalModeTools(): void {
			pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
			toolsBeforePlanMode = undefined;
		}

		function persistState(): void {
			const data: PlanModeState = {
				enabled: planModeEnabled,
				todos: todoItems,
				executing: executionMode,
				toolsBeforePlanMode,
			};
			pi.appendEntry(PLAN_MODE_ENTRY, data);
		}

		function togglePlanMode(ctx: ExtensionContext): void {
			planModeEnabled = !planModeEnabled;
			executionMode = false;
			todoItems = [];

			if (planModeEnabled) {
				enablePlanModeTools();
				ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
			} else {
				restoreNormalModeTools();
				ctx.ui.notify("Plan mode disabled. Full access restored.");
			}
			updateStatus(ctx);
			persistState();
		}

		pi.registerCommand("plan", {
			description: "Toggle plan mode (read-only exploration)",
			handler: async (_args, ctx) => togglePlanMode(ctx),
		});

		pi.registerCommand("todos", {
			description: "Show current plan todo list",
			handler: async (_args, ctx) => {
				if (todoItems.length === 0) {
					ctx.ui.notify("No todos. Create a plan first with /plan", "info");
					return;
				}
				const list = todoItems
					.map((item, index) => `${index + 1}. ${item.completed ? "✓" : "○"} ${item.text}`)
					.join("\n");
				ctx.ui.notify(`Plan Progress:\n${list}`, "info");
			},
		});

		pi.registerShortcut(Key.ctrlAlt("p"), {
			description: "Toggle plan mode",
			handler: async (ctx) => togglePlanMode(ctx),
		});

		pi.on("before_agent_start", async () => {
			if (executionMode && todoItems.length > 0) {
				const remaining = todoItems.filter((item) => !item.completed);
				const todoList = remaining.map((item) => `${item.step}. ${item.text}`).join("\n");
				return {
					message: {
						customType: "plan-execution-context",
						content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
						display: false,
					},
				};
			}
		});

		pi.on("tool_call", async (event) => {
			if (!planModeEnabled || event.toolName !== "bash") return;
			const command = event.input.command as string;
			if (!isSafePlanModeBashCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
				};
			}
		});

		pi.on("turn_end", async (event, ctx) => {
			if (!executionMode || todoItems.length === 0) return;
			if (!isAssistantMessage(event.message)) return;
			if (markCompletedPlanSteps(getTextContent(event.message), todoItems) > 0) {
				updateStatus(ctx);
			}
			persistState();
		});

		pi.on("agent_end", async (event, ctx) => {
			if (executionMode && todoItems.length > 0) {
				if (todoItems.every((item) => item.completed)) {
					const completedList = todoItems.map((item) => `~~${item.text}~~`).join("\n");
					pi.sendMessage(
						{ customType: "plan-complete", content: `**Plan Complete!**\n\n${completedList}`, display: true },
						{ triggerTurn: false },
					);
					executionMode = false;
					todoItems = [];
					updateStatus(ctx);
					persistState();
				}
				return;
			}

			if (!planModeEnabled || !ctx.hasUI) return;

			const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
			if (lastAssistant) {
				const extracted = extractPlanTodoItems(getTextContent(lastAssistant));
				if (extracted.length > 0) todoItems = extracted;
			}
			if (todoItems.length === 0) return;
			persistState();

			const todoListText = todoItems.map((item, index) => `${index + 1}. ☐ ${item.text}`).join("\n");
			const planTodoListMessage = {
				customType: "plan-todo-list",
				content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
				display: true,
			};

			const choice = await ctx.ui.select("Plan mode - what next?", [
				"Execute the plan (track progress)",
				"Stay in plan mode",
				"Refine the plan",
			]);

			if (choice?.startsWith("Execute")) {
				const firstTodoItem = todoItems[0];
				if (!firstTodoItem) return;

				let goalCard = loadGoalCardFromBranch(ctx.sessionManager.getBranch()) ?? emptyGoalCard();
				const edited = await editGoalCardAtPlanApprove(ctx.ui, goalCard);
				if (!edited) return;
				goalCard = goalCardWithPlanSteps(edited, todoItems);
				pi.appendEntry(GOAL_CARD_ENTRY, goalCard);

				planModeEnabled = false;
				executionMode = true;
				restoreNormalModeTools();
				updateStatus(ctx);
				persistState();

				const remainingList = todoItems.map((item) => `${item.step}. ${item.text}`).join("\n");
				const execMessage = `Execute the approved plan (GoalCard plan steps are set).

Remaining steps:
${remainingList}

Start with: ${firstTodoItem.text}
After completing a step, include a [DONE:n] tag in your response.`;
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendMessage(
					{ customType: "plan-mode-execute", content: execMessage, display: true },
					{ triggerTurn: true, deliverAs: "followUp" },
				);
			} else if (choice === "Refine the plan") {
				const refinement = await ctx.ui.editor("Refine the plan:", "");
				if (refinement?.trim()) {
					pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
					pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
				}
			}
		});

		pi.on("session_start", async (_event, ctx) => {
			if (pi.getFlag("plan") === true) {
				planModeEnabled = true;
			}

			const entries = ctx.sessionManager.getEntries();
			const planModeEntry = entries
				.filter((entry) => entry.type === "custom" && entry.customType === PLAN_MODE_ENTRY)
				.pop() as { data?: PlanModeState } | undefined;

			if (planModeEntry?.data) {
				planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
				todoItems = planModeEntry.data.todos ?? todoItems;
				executionMode = planModeEntry.data.executing ?? executionMode;
				toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
			}

			const isResume = planModeEntry !== undefined;
			if (isResume && executionMode && todoItems.length > 0) {
				let executeIndex = -1;
				for (let index = entries.length - 1; index >= 0; index--) {
					const entry = entries[index] as { type: string; customType?: string };
					if (entry.customType === "plan-mode-execute") {
						executeIndex = index;
						break;
					}
				}
				const messages: AssistantMessage[] = [];
				for (let index = executeIndex + 1; index < entries.length; index++) {
					const entry = entries[index];
					if (
						entry.type === "message" &&
						"message" in entry &&
						isAssistantMessage(entry.message as AgentMessage)
					) {
						messages.push(entry.message as AssistantMessage);
					}
				}
				markCompletedPlanSteps(messages.map(getTextContent).join("\n"), todoItems);
			}

			if (planModeEnabled) {
				enablePlanModeTools();
			}
			updateStatus(ctx);
		});
	};
}

export default createPlanModeExtension();
