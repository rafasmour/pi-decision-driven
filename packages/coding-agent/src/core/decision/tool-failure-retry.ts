import { DECISION_TOOL_NAME } from "@earendil-works/pi-agent-core";
import { contentText, type ToolResultMessage } from "@earendil-works/pi-ai";

export const DECISION_TOOL_FAILURE_RETRY_CAP = 2;

/** Collect error text from failed tool results in a turn. */
export function failedToolErrorSummaries(toolResults: readonly ToolResultMessage[]): string[] {
	const summaries: string[] = [];
	for (const result of toolResults) {
		if (!result.isError) continue;
		const text = contentText(result.content, " ").trim().replace(/\s+/g, " ");
		const detail = text.length > 0 ? text.slice(0, 500) : "unknown error";
		summaries.push(`${result.toolName}: ${detail}`);
	}
	return summaries;
}

/** Harness note that tells the model to retry without the failed turn in context. */
export function toolFailureRetryHarnessMessage(toolResults: readonly ToolResultMessage[]): string {
	const failures = failedToolErrorSummaries(toolResults);
	const lines = [
		"<decision_harness>",
		"The previous assistant turn failed and was removed from context. Do not repeat the same invalid call.",
		...failures.map((failure) => `Failure: ${failure}`),
	];
	const askFailed = toolResults.some((result) => result.isError && result.toolName === DECISION_TOOL_NAME);
	if (askFailed) {
		lines.push(
			`Retry with a valid ${DECISION_TOOL_NAME}: one complete self-contained concern per question; omit options for yes/no, or provide at least two options — never a single option.`,
		);
	} else {
		lines.push("Retry with a corrected approach that addresses the failure above.");
	}
	lines.push("</decision_harness>");
	return lines.join("\n");
}
