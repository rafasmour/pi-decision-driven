import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";

const DANGEROUS_BASH_PATTERN =
	/\b(rm\s+-rf|git\s+(push|reset\s+--hard|clean\s+-fd|checkout\s+\.|rebase)|chmod\s+777|curl\s+.*\|\s*(ba)?sh|wget\s+.*\|\s*(ba)?sh|npm\s+publish|sudo\s+)\b/i;

const DANGEROUS_GIT_PATTERN = /\b(push\s+--force|reset\s+--hard|clean\s+-fd)\b/i;

export function isStaticallyDeniedBash(command: string): boolean {
	return DANGEROUS_BASH_PATTERN.test(command);
}

export function isStaticallyDeniedGit(args: string): boolean {
	return DANGEROUS_GIT_PATTERN.test(args);
}

export function isStaticallyDeniedToolCall(toolName: string, args: Record<string, unknown>): boolean {
	if (toolName === "bash") {
		const command = typeof args.command === "string" ? args.command : "";
		return isStaticallyDeniedBash(command);
	}
	if (toolName === "git") {
		const sub = typeof args.command === "string" ? args.command : JSON.stringify(args);
		return isStaticallyDeniedGit(sub);
	}
	return false;
}

export function needsSecuritySensitivityClassify(toolName: string, args: Record<string, unknown>): boolean {
	if (toolName !== "bash" && toolName !== "git" && toolName !== "write" && toolName !== "edit") return false;
	if (isStaticallyDeniedToolCall(toolName, args)) return false;
	if (toolName === "bash") {
		const command = typeof args.command === "string" ? args.command : "";
		if (!command.trim()) return false;
		return /\b(rm|mv|chmod|chown|curl|wget|npm|pnpm|yarn|docker|kubectl|sudo|git)\b/i.test(command);
	}
	return true;
}

export function securityClassifierContext(toolName: string, args: Record<string, unknown>): ClassifierContext {
	const summary =
		toolName === "bash" && typeof args.command === "string"
			? args.command.slice(0, 2_000)
			: JSON.stringify(args).slice(0, 2_000);
	return {
		state: { tool: toolName, summary },
		questions: {
			is_security_sensitive: {
				type: "bool",
				instructions:
					"Could executing `summary` with tool `tool` mutate production data, leak secrets, or damage the repo?",
				criteria: {
					true: "Yes — needs human approval",
					false: "No — routine and reversible",
				},
			},
		},
	};
}

export function isSecuritySensitiveResult(result: Pick<ClassifierResult, "answers" | "stopReason">): boolean {
	if (result.stopReason !== "stop") return true;
	const answer = result.answers.is_security_sensitive;
	if (answer?.type !== "bool") return true;
	return answer.probability >= 0.5;
}
