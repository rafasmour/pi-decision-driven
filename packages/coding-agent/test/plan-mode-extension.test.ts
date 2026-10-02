import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
	isPlanModePlanning,
	loadPlanModeFromBranch,
	PLAN_MODE_ENTRY,
	type PlanModeState,
} from "../src/core/decision/plan-mode-state.ts";
import { planModeSystemSection } from "../src/core/decision/plan-routing.ts";
import type { ExtensionAPI, ExtensionContext } from "../src/core/extensions/index.ts";
import type { CustomEntry, SessionEntry } from "../src/core/session-manager.ts";
import planModeExtension from "../src/extensions/plan-mode/index.ts";

type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void> | void;
type AgentEndHandler = (
	event: { type: "agent_end"; messages: AgentMessage[] },
	ctx: ExtensionContext,
) => Promise<void> | void;

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

type SessionStartHandler = (event: { type: "session_start" }, ctx: ExtensionContext) => Promise<void> | void;

function customPlanModeEntry(data: PlanModeState): CustomEntry<PlanModeState> {
	return {
		id: "plan-mode-entry",
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		type: "custom",
		customType: PLAN_MODE_ENTRY,
		data,
	};
}

function setup(
	options: {
		activeTools?: string[];
		selectChoice?: string;
		editorText?: string;
		editorTexts?: string[];
		planFlag?: boolean;
		branch?: SessionEntry[];
	} = {},
) {
	let activeTools = options.activeTools ?? ["read", "bash", "edit", "write"];
	const branch: SessionEntry[] = [...(options.branch ?? [])];
	const commands = new Map<string, CommandHandler>();
	let agentEndHandler: AgentEndHandler | undefined;
	let sessionStartHandler: SessionStartHandler | undefined;
	const sideEffectOrder: string[] = [];

	const sendMessage = vi.fn<ExtensionAPI["sendMessage"]>();
	const sendUserMessage = vi.fn<ExtensionAPI["sendUserMessage"]>();
	const setActiveTools = vi.fn<ExtensionAPI["setActiveTools"]>((toolNames) => {
		sideEffectOrder.push("setActiveTools");
		activeTools = [...toolNames];
	});
	const appendEntry = vi.fn<ExtensionAPI["appendEntry"]>((customType, data) => {
		sideEffectOrder.push("appendEntry");
		branch.push({
			id: `custom-${branch.length}`,
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			type: "custom",
			customType,
			data,
		});
	});

	const api = {
		registerFlag: vi.fn(),
		registerCommand(name: string, command: { handler: CommandHandler }) {
			commands.set(name, command.handler);
		},
		registerShortcut: vi.fn(),
		on(event: string, handler: unknown) {
			if (event === "agent_end") agentEndHandler = handler as AgentEndHandler;
			if (event === "session_start") sessionStartHandler = handler as SessionStartHandler;
		},
		getFlag: vi.fn((name: string) => (name === "plan" ? options.planFlag === true : false)),
		getActiveTools: vi.fn(() => [...activeTools]),
		setActiveTools,
		sendMessage,
		sendUserMessage,
		appendEntry,
	} as unknown as ExtensionAPI;

	planModeExtension(api);

	let editorCall = 0;
	const ctx = {
		hasUI: true,
		ui: {
			notify: vi.fn(),
			select: vi.fn(async () => options.selectChoice),
			editor: vi.fn(async () => {
				if (options.editorTexts) {
					const text = options.editorTexts[editorCall];
					editorCall++;
					return text;
				}
				return options.editorText;
			}),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
			theme: {
				fg: (_name: string, text: string) => text,
				strikethrough: (text: string) => text,
			},
		},
		sessionManager: {
			getEntries: () => branch,
			getBranch: () => branch,
			appendCustomEntry: vi.fn(() => 0),
		},
		isIdle: () => false,
		hasPendingMessages: () => false,
	} as unknown as ExtensionContext;

	async function runCommand(name: string): Promise<void> {
		const command = commands.get(name);
		if (!command) throw new Error(`Missing command: ${name}`);
		await command("", ctx);
	}

	async function triggerAgentEnd(text: string): Promise<void> {
		if (!agentEndHandler) throw new Error("Missing agent_end handler");
		await agentEndHandler({ type: "agent_end", messages: [createAssistantMessage(text)] }, ctx);
	}

	async function triggerSessionStart(): Promise<void> {
		if (!sessionStartHandler) throw new Error("Missing session_start handler");
		await sessionStartHandler({ type: "session_start" }, ctx);
	}

	function planModeSectionVisibleAfterLastSideEffect(): boolean {
		const lastIndex = sideEffectOrder.lastIndexOf("setActiveTools");
		const branchAtRebuild = branch.slice(0, lastIndex >= 0 ? countBranchEntriesThrough(lastIndex) : branch.length);
		return isPlanModePlanning(loadPlanModeFromBranch(branchAtRebuild)) === true;
	}

	function countBranchEntriesThrough(sideEffectIndex: number): number {
		let entries = 0;
		for (let i = 0; i <= sideEffectIndex; i++) {
			if (sideEffectOrder[i] === "appendEntry") entries++;
		}
		return entries;
	}

	return {
		activeTools: () => activeTools,
		appendEntry,
		branch: () => branch,
		ctx,
		planModeSectionVisibleAfterLastSideEffect,
		runCommand,
		sendMessage,
		sendUserMessage,
		setActiveTools,
		sideEffectOrder: () => [...sideEffectOrder],
		triggerAgentEnd,
		triggerSessionStart,
	};
}

function planModeSectionForBranch(branch: readonly SessionEntry[]): string | undefined {
	if (!isPlanModePlanning(loadPlanModeFromBranch(branch))) return undefined;
	return planModeSystemSection(true);
}

describe("plan-mode built-in extension", () => {
	it("persists plan mode before setActiveTools when toggling on", async () => {
		const { planModeSectionVisibleAfterLastSideEffect, runCommand, sideEffectOrder } = setup();

		await runCommand("plan");

		expect(sideEffectOrder()).toEqual(["appendEntry", "setActiveTools"]);
		expect(planModeSectionVisibleAfterLastSideEffect()).toBe(true);
		expect(planModeSectionForBranch([])).toBeUndefined();
		expect(planModeSectionForBranch([customPlanModeEntry({ enabled: true })])).toBeDefined();
	});

	it("persists enabled state when --plan starts a fresh session", async () => {
		const { appendEntry, branch, triggerSessionStart } = setup({ planFlag: true });

		await triggerSessionStart();

		expect(appendEntry).toHaveBeenCalledWith(
			PLAN_MODE_ENTRY,
			expect.objectContaining({ enabled: true } satisfies Partial<PlanModeState>),
		);
		expect(isPlanModePlanning(loadPlanModeFromBranch(branch()))).toBe(true);
	});

	it("preserves custom active tools while toggling plan mode", async () => {
		const { activeTools, runCommand, setActiveTools } = setup({
			activeTools: ["read", "bash", "edit", "write", "echo_tool"],
		});

		await runCommand("plan");

		expect(activeTools()).toEqual(["read", "bash", "echo_tool", "grep", "find", "ls"]);
		expect(setActiveTools).toHaveBeenLastCalledWith(["read", "bash", "echo_tool", "grep", "find", "ls"]);

		await runCommand("plan");

		expect(activeTools()).toEqual(["read", "bash", "edit", "write", "echo_tool"]);
		expect(setActiveTools).toHaveBeenLastCalledWith(["read", "bash", "edit", "write", "echo_tool"]);
	});

	it("does not prompt when the assistant response contains no plan", async () => {
		const { ctx, runCommand, sendMessage, triggerAgentEnd } = setup();

		await runCommand("plan");
		await triggerAgentEnd("This file defines the command-line argument parser.");

		expect(ctx.ui.select).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("queues plan refinement as a follow-up user message", async () => {
		const { runCommand, sendUserMessage, triggerAgentEnd } = setup({
			selectChoice: "Refine the plan",
			editorText: "Add a regression test.",
		});

		await runCommand("plan");
		await triggerAgentEnd("Plan:\n1. Inspect the current implementation\n2. Add a regression test");

		expect(sendUserMessage).toHaveBeenCalledWith("Add a regression test.", { deliverAs: "followUp" });
	});

	it("queues plan execution as a follow-up custom message", async () => {
		const { activeTools, runCommand, sendMessage, triggerAgentEnd } = setup({
			activeTools: ["read", "bash", "edit", "write", "echo_tool"],
			selectChoice: "Execute the plan (track progress)",
			editorTexts: ["Ship the feature", "Tests pass"],
		});

		await runCommand("plan");
		await triggerAgentEnd("Plan:\n1. Inspect the current implementation\n2. Add a regression test");

		expect(activeTools()).toEqual(["read", "bash", "edit", "write", "echo_tool"]);
		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "plan-mode-execute" }), {
			triggerTurn: true,
			deliverAs: "followUp",
		});
	});
});
