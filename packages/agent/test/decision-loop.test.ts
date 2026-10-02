import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type ClassifierAnswer,
	type ClassifierQuestion,
	EventStream,
	type Message,
	type Model,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { agentLoop, createMessageCheckpoint, restoreMessagesToCheckpoint } from "../src/agent-loop.ts";
import {
	type AgentContext,
	type AgentEvent,
	type AgentLoopConfig,
	type AgentMessage,
	type AgentTool,
	type AgentToolCall,
	DECISION_TOOL_NAME,
	type DecisionClassify,
	type DecisionConfig,
} from "../src/index.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(m) => m.role === "system" || m.role === "user" || m.role === "assistant" || m.role === "toolResult",
	) as Message[];
}

const questions: Record<string, ClassifierQuestion> = {
	proceed: { type: "bool", instructions: "Should we proceed?", criteria: { true: "yes", false: "no" } },
};
const fixedAnswers: Record<string, ClassifierAnswer> = { proceed: { type: "bool", probability: 0.9 } };

/** Streams the given assistant messages one per request, then a final text reply. */
function scriptedStream(...turns: AssistantMessage[]) {
	let index = 0;
	return () => {
		const stream = new MockAssistantStream();
		const message = turns[index] ?? createAssistantMessage([{ type: "text", text: "done" }]);
		index++;
		queueMicrotask(() => stream.push({ type: "done", reason: message.stopReason as "stop", message }));
		return stream;
	};
}

/** Tool-call arguments as a provider would deliver them: parsed from JSON. */
function jsonArguments(value: object): AgentToolCall["arguments"] {
	return JSON.parse(JSON.stringify(value));
}

function decisionCall(
	id = "decision-1",
	args: AgentToolCall["arguments"] = jsonArguments({ questions }),
): AssistantMessage {
	return createAssistantMessage([{ type: "toolCall", id, name: DECISION_TOOL_NAME, arguments: args }], "toolUse");
}

async function collect(
	config: AgentLoopConfig,
	context: AgentContext,
	streamFn: ReturnType<typeof scriptedStream>,
): Promise<{ events: AgentEvent[]; messages: AgentMessage[] }> {
	const events: AgentEvent[] = [];
	const prompt: AgentMessage = { role: "user", content: "decide", timestamp: Date.now() };
	const stream = agentLoop([prompt], context, config, undefined, streamFn);
	for await (const event of stream) events.push(event);
	return { events, messages: await stream.result() };
}

describe("decision-driven loop", () => {
	it("accepts questionnaire-shaped ask_decision questions", async () => {
		const classify = vi.fn(async () => ({ answers: fixedAnswers, stopReason: "stop" as const }));
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			classify,
		};
		const questionnaireArgs = jsonArguments({
			questions: [{ id: "proceed", prompt: "Should we proceed?" }],
		});
		const { events } = await collect(
			config,
			{ messages: [], tools: [] },
			scriptedStream(decisionCall("decision-q", questionnaireArgs)),
		);
		expect(classify).toHaveBeenCalledWith(
			expect.objectContaining({
				questions: expect.objectContaining({
					proceed: expect.objectContaining({ type: "bool" }),
				}),
			}),
			undefined,
		);
		expect(events.some((e) => e.type === "decision_end" && e.phase === "classify")).toBe(true);
	});

	it("classifies an ask_decision turn, emits decision events, and continues", async () => {
		const classifyCalls: unknown[] = [];
		const classify: DecisionClassify = async (context) => {
			classifyCalls.push(context);
			return { answers: fixedAnswers, stopReason: "stop" };
		};
		let otherToolRuns = 0;
		const otherTool: AgentTool = {
			name: "other",
			label: "Other",
			description: "must not run",
			parameters: Type.Object({}),
			async execute() {
				otherToolRuns++;
				return { content: [], details: {} };
			},
		};
		const config: AgentLoopConfig = { model: createModel(), convertToLlm: identityConverter, classify };

		const { events, messages } = await collect(
			config,
			{ messages: [], tools: [otherTool] },
			scriptedStream(decisionCall("decision-1", jsonArguments({ questions, state: { step: 1 } }))),
		);

		expect(classifyCalls).toEqual([{ state: { step: 1 }, questions }]);
		expect(otherToolRuns).toBe(0);

		const decisionEvents = events.filter((e) => e.type === "decision_start" || e.type === "decision_end");
		expect(decisionEvents).toEqual([
			{ type: "decision_start", phase: "classify", questions },
			{ type: "decision_end", phase: "classify", questions, answers: fixedAnswers },
		]);
		// Events stay JSON-serializable.
		expect(JSON.parse(JSON.stringify(decisionEvents))).toEqual(decisionEvents);

		const toolResult = messages.find((m) => m.role === "toolResult");
		expect(toolResult?.role === "toolResult" ? toolResult.toolCallId : undefined).toBe("decision-1");
		expect(
			toolResult?.role === "toolResult" && toolResult.content[0].type === "text" && toolResult.content[0].text,
		).toBe(JSON.stringify(fixedAnswers));
		// The loop continued with another assistant turn after the decision.
		expect(messages.filter((m) => m.role === "assistant")).toHaveLength(2);
	});

	it("also enables decision mode with decisionDriven and appends interpretDecision messages", async () => {
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			decisionDriven: true,
			classify: async () => ({ answers: fixedAnswers, stopReason: "stop" }),
			interpretDecision: ({ answers }) => [
				{ role: "user", content: `answers: ${Object.keys(answers).join(",")}`, timestamp: Date.now() },
			],
		};

		const { messages } = await collect(config, { messages: [], tools: [] }, scriptedStream(decisionCall()));

		const roles = messages.map((m) => m.role);
		expect(roles).toEqual(["user", "assistant", "toolResult", "user", "assistant"]);
		const appended = messages[3];
		expect(appended.role === "user" && appended.content).toBe("answers: proceed");
	});

	it("returns a classifier failure to the model as an error tool result", async () => {
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			classify: async () => ({ answers: {}, stopReason: "error", errorMessage: "classifier down" }),
		};

		const { events, messages } = await collect(config, { messages: [], tools: [] }, scriptedStream(decisionCall()));

		const end = events.find((e) => e.type === "decision_end");
		expect(end).toEqual({ type: "decision_end", phase: "classify", questions });
		const toolResult = messages.find((m) => m.role === "toolResult");
		expect(toolResult?.role === "toolResult" && toolResult.isError).toBe(true);
		expect(
			toolResult?.role === "toolResult" && toolResult.content[0].type === "text" && toolResult.content[0].text,
		).toBe("classifier down");
	});

	it("awaits a human and ends the run when decisionDriven has no classifier", async () => {
		const config: AgentLoopConfig = { model: createModel(), convertToLlm: identityConverter, decisionDriven: true };

		const { events, messages } = await collect(config, { messages: [], tools: [] }, scriptedStream(decisionCall()));

		const decisionEvents = events.filter((e) => e.type === "decision_start" || e.type === "decision_end");
		expect(decisionEvents).toEqual([
			{ type: "decision_start", phase: "await_human", questions },
			{ type: "decision_end", phase: "await_human", questions },
		]);
		expect(messages.filter((m) => m.role === "assistant")).toHaveLength(1);
		expect(messages.some((m) => m.role === "toolResult")).toBe(true);
	});

	it("errors on malformed decision arguments without calling classify", async () => {
		let called = false;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			classify: async () => {
				called = true;
				return { answers: {}, stopReason: "stop" };
			},
		};

		const { messages } = await collect(
			config,
			{ messages: [], tools: [] },
			scriptedStream(decisionCall("decision-1", { questions: {} })),
		);

		expect(called).toBe(false);
		const toolResult = messages.find((m) => m.role === "toolResult");
		expect(toolResult?.role === "toolResult" && toolResult.isError).toBe(true);
	});

	it("does not treat ask_decision specially without decision mode", async () => {
		const config: AgentLoopConfig = { model: createModel(), convertToLlm: identityConverter };

		const { events, messages } = await collect(config, { messages: [], tools: [] }, scriptedStream(decisionCall()));

		expect(events.some((e) => e.type === "decision_start")).toBe(false);
		const toolResult = messages.find((m) => m.role === "toolResult");
		expect(toolResult?.role === "toolResult" && toolResult.isError).toBe(true);
		expect(
			toolResult?.role === "toolResult" && toolResult.content[0].type === "text" && toolResult.content[0].text,
		).toBe(`Tool ${DECISION_TOOL_NAME} not found`);
	});

	it("reports the decision phase on the turn passed to finishTurn", async () => {
		const phases: Array<string | undefined> = [];
		const finishTurn: AgentLoopConfig["finishTurn"] = (turn) => {
			phases.push(turn.decisionPhase);
		};

		// Settled decision: back to idle.
		await collect(
			{
				model: createModel(),
				convertToLlm: identityConverter,
				classify: async () => ({ answers: fixedAnswers, stopReason: "stop" }),
				finishTurn,
			},
			{ messages: [], tools: [] },
			scriptedStream(decisionCall()),
		);
		// Waiting on a person.
		await collect(
			{ model: createModel(), convertToLlm: identityConverter, decisionDriven: true, finishTurn },
			{ messages: [], tools: [] },
			scriptedStream(decisionCall()),
		);
		// Outside decision mode the field is absent.
		await collect(
			{ model: createModel(), convertToLlm: identityConverter, finishTurn },
			{ messages: [], tools: [] },
			scriptedStream(),
		);

		expect(phases).toEqual(["idle", "idle", "await_human", undefined]);
	});

	it("exposes decisionConfig on the loop config", () => {
		const decisionConfig: DecisionConfig = { maxQualityRetries: 2, confidenceThreshold: 0.7 };
		const config: AgentLoopConfig = { model: createModel(), convertToLlm: identityConverter, decisionConfig };

		expect(config.decisionConfig?.maxQualityRetries).toBe(2);
		expect(config.decisionConfig?.confidenceThreshold).toBe(0.7);
	});
});

describe("message checkpoints", () => {
	const message = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 });

	it("restores messages to the checkpoint index and returns the discarded tail", () => {
		const messages = [message("a"), message("b")];
		const checkpoint = createMessageCheckpoint(messages);
		messages.push(message("draft 1"), message("draft 2"));

		const removed = restoreMessagesToCheckpoint(messages, checkpoint);

		expect(messages.map((m) => m.role === "user" && m.content)).toEqual(["a", "b"]);
		expect(removed.map((m) => m.role === "user" && m.content)).toEqual(["draft 1", "draft 2"]);
	});

	it("is a no-op at the end and clears everything at zero", () => {
		const messages = [message("a")];
		expect(restoreMessagesToCheckpoint(messages, 1)).toEqual([]);
		expect(messages).toHaveLength(1);
		restoreMessagesToCheckpoint(messages, 0);
		expect(messages).toHaveLength(0);
	});

	it("rejects out-of-range or non-integer indexes", () => {
		const messages = [message("a")];
		expect(() => restoreMessagesToCheckpoint(messages, 2)).toThrow(RangeError);
		expect(() => restoreMessagesToCheckpoint(messages, -1)).toThrow(RangeError);
		expect(() => restoreMessagesToCheckpoint(messages, 0.5)).toThrow(RangeError);
		expect(messages).toHaveLength(1);
	});
});
