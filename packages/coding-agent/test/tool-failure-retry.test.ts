import { DECISION_TOOL_NAME } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { failedToolErrorSummaries, toolFailureRetryHarnessMessage } from "../src/core/decision/tool-failure-retry.ts";

function toolResult(toolName: string, text: string, isError: boolean): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "1",
		toolName,
		content: [{ type: "text", text }],
		isError,
		timestamp: 0,
	};
}

describe("tool failure retry harness", () => {
	it("summarizes only failed tool results", () => {
		const results = [
			toolResult("write", "ok", false),
			toolResult(DECISION_TOOL_NAME, 'Question "explore_structure" has a single option', true),
		];
		expect(failedToolErrorSummaries(results)).toEqual([
			`${DECISION_TOOL_NAME}: Question "explore_structure" has a single option`,
		]);
	});

	it("includes ask_decision option rules when ask_decision failed", () => {
		const message = toolFailureRetryHarnessMessage([
			toolResult(DECISION_TOOL_NAME, 'Question "explore_structure" has a single option', true),
		]);
		expect(message).toContain("<decision_harness>");
		expect(message).toContain("explore_structure");
		expect(message).toContain("never a single option");
		expect(message).toContain("removed from context");
	});

	it("asks for a corrected approach for other tool failures", () => {
		const message = toolFailureRetryHarnessMessage([toolResult("bash", "exit 1", true)]);
		expect(message).toContain("bash: exit 1");
		expect(message).toContain("corrected approach");
		expect(message).not.toContain("never a single option");
	});
});
