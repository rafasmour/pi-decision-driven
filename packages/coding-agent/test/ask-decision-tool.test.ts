import { DECISION_TOOL_NAME } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { decisionPreAuthToolNames } from "../src/core/decision/pre-auth-tools.ts";
import { createAskDecisionToolDefinition } from "../src/core/tools/ask-decision.ts";
import { toolNamesForIntent } from "../src/core/decision/tool-intent.ts";

describe("ask_decision tool", () => {
	it("registers under the reserved decision tool name", () => {
		const def = createAskDecisionToolDefinition();
		expect(def.name).toBe(DECISION_TOOL_NAME);
		expect(def.promptSnippet).toBeTruthy();
	});
});

describe("decision pre-auth tools", () => {
	it("keeps ask_decision and read-only tools", () => {
		expect(decisionPreAuthToolNames(["read", "bash", "edit", DECISION_TOOL_NAME, "grep"])).toEqual([
			"read",
			DECISION_TOOL_NAME,
			"grep",
		]);
	});
});

describe("tool intent restriction", () => {
	it("keeps ask_decision when restricting to a tool family", () => {
		expect(toolNamesForIntent("bash", ["read", "bash", "edit", DECISION_TOOL_NAME])).toEqual([
			"bash",
			DECISION_TOOL_NAME,
		]);
	});
});
