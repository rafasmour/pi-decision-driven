/**
 * System prompt construction and project context loading
 */

import { getSystemMessageText } from "@earendil-works/pi-ai";
import { getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import type { DecisionSessionPhase } from "./decision/decision-session-phase.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces the default prefix). */
	customPrompt?: string;
	/** Exact full prompt replacement set by a before_agent_start handler. */
	forceSystemPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write]. */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Guideline bullets contributed by each tool, keyed by tool name. */
	toolGuidelines?: Record<string, string[]>;
	/** Additional guideline bullets appended to the default system prompt rules. */
	promptGuidelines?: string[];
	/** Text appended from user configuration before project context, skills, and cwd. */
	appendSystemPrompt?: string;
	/** Additional XML-wrapped prompt sections keyed by tag name. */
	sections?: Record<string, string>;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
	/** Decision-driven mode: plain-text questions + tools only; S4 skill index behavior. */
	decisionDriven?: boolean;
	/**
	 * Current harness phase. Drives `<decision_loop>` copy for ask/nudge/act/verify.
	 */
	decisionSessionPhase?: DecisionSessionPhase;
}

export type NormalizedBuildSystemPromptOptions = BuildSystemPromptOptions & {
	selectedTools: string[];
	toolSnippets: Record<string, string>;
	toolGuidelines: Record<string, string[]>;
	promptGuidelines: string[];
	appendSystemPrompt: string;
	sections: Record<string, string>;
	contextFiles: Array<{ path: string; content: string }>;
	skills: Skill[];
};

/**
 * Ordered system prompt sections, keyed by name. `preamble` is untagged text; every other
 * section is wrapped in a tag of the same name so the model can match later updates to it.
 * These become `SystemMessage.sections` in the transcript.
 */
export type SystemPromptSections = Record<string, string>;

const SYSTEM_PROMPT_SECTION_NAME = /^[a-z][a-z0-9_-]*$/;
/** Normalize prompt input into the mutable, collection-complete shape exposed to extensions. */
export function normalizeBuildSystemPromptOptions(input: BuildSystemPromptOptions): NormalizedBuildSystemPromptOptions {
	return {
		customPrompt: input.customPrompt,
		forceSystemPrompt: input.forceSystemPrompt,
		selectedTools: [...(input.selectedTools ?? ["read", "bash", "edit", "write"])],
		toolSnippets: { ...(input.toolSnippets ?? {}) },
		toolGuidelines: Object.fromEntries(
			Object.entries(input.toolGuidelines ?? {}).map(([name, guidelines]) => [name, [...guidelines]]),
		),
		promptGuidelines: [...(input.promptGuidelines ?? [])],
		appendSystemPrompt: input.appendSystemPrompt ?? "",
		sections: { ...(input.sections ?? {}) },
		cwd: input.cwd,
		contextFiles: (input.contextFiles ?? []).map((file) => ({ ...file })),
		skills: (input.skills ?? []).map((skill) => ({ ...skill })),
		decisionDriven: input.decisionDriven ?? false,
		decisionSessionPhase: input.decisionSessionPhase,
	};
}

function renderProjectContext(contextFiles: Array<{ path: string; content: string }>): string {
	return [
		"Project-specific instructions and guidelines:",
		...contextFiles.map(
			({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
		),
	].join("\n\n");
}

function buildRules(
	selectedTools: string[],
	toolGuidelines: Record<string, string[]>,
	promptGuidelines: string[],
): string {
	const rules: string[] = [];
	const seen = new Set<string>();
	const addRule = (rule: string): void => {
		const normalized = rule.trim();
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		rules.push(normalized);
	};

	const hasBash = selectedTools.includes("bash");
	const hasPowerShell = selectedTools.includes("powershell");
	const hasGrep = selectedTools.includes("grep");
	const hasFind = selectedTools.includes("find");
	const hasLs = selectedTools.includes("ls");

	if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
		if (hasBash && hasPowerShell) {
			addRule("Use bash or PowerShell for file operations like listing, searching, and finding files");
		} else if (hasPowerShell) {
			addRule("Use PowerShell for file operations like listing, searching, and finding files");
		} else {
			addRule("Use bash for file operations like ls, rg, find");
		}
	}

	for (const name of selectedTools) {
		for (const rule of toolGuidelines[name] ?? []) addRule(rule);
	}
	for (const rule of promptGuidelines) addRule(rule);
	addRule("Be concise in your responses");
	addRule("Show file paths clearly when working with files");
	return rules.map((rule) => `- ${rule}`).join("\n");
}

/** Build the ordered, independently replaceable sections of the structured system prompt. */
export function buildSystemPromptSections(input: BuildSystemPromptOptions): SystemPromptSections {
	const options = normalizeBuildSystemPromptOptions(input);
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		toolGuidelines,
		promptGuidelines,
		appendSystemPrompt,
		sections: customSections,
		cwd,
		contextFiles,
		skills,
		decisionDriven,
		decisionSessionPhase,
	} = options;

	for (const name of Object.keys(customSections)) {
		if (!SYSTEM_PROMPT_SECTION_NAME.test(name) || name === "preamble") {
			throw new Error(`Invalid system prompt section name: ${name}`);
		}
	}

	const promptSections: Record<string, string> = {};
	if (customPrompt) {
		promptSections.preamble = customPrompt;
	} else {
		promptSections.preamble = decisionDriven
			? [
					"You are the chat model in pi's decision-driven harness.",
					"Do not take decisions in your thought process or reasoning — never pick options, policies, designs, or next steps there.",
					"In thinking, only describe the situation (facts, uncertainty, what is unknown). Then call ask_decision so the decision model chooses.",
					"You do not decide product choices, policy, or next implementation steps yourself — always pose them via ask_decision.",
					"Default mode is Ask: your only allowed tool until Act unlock is ask_decision.",
					"Do not call read, write, edit, bash, grep, find, ls, or any other tool until ask_decision has returned answers that authorize Act tools and those tools appear in the current tool list.",
					"Never invent classifier answers, never skip Ask to start coding or exploring, never put decisions in prose JSON or markdown fences when ask_decision is available.",
					"Act mode begins only after the harness unlocks tools from classified (or human-routed) answers.",
				].join(" ")
			: "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
		const visibleTools = selectedTools.filter((name) => !!toolSnippets[name]);
		const tools =
			visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n") : "(none)";
		promptSections.tools = `${tools}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;
		promptSections.rules = buildRules(selectedTools, toolGuidelines, promptGuidelines);
		promptSections.docs = `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${getReadmePath()}
- Additional docs: ${getDocsPath()}
- Examples: ${getExamplesPath()} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
	}

	if (appendSystemPrompt) promptSections.addendum = appendSystemPrompt;
	if (contextFiles.length > 0) promptSections.project_context = renderProjectContext(contextFiles);
	const skillFileReadTool = (["read", "bash"] as const).find((tool) => selectedTools.includes(tool));
	if (decisionDriven) {
		if (decisionSessionPhase === "ask") {
			promptSections.decision_loop = [
				"Phase: ask. Act tools are not authorized.",
				"Do not decide in thinking — only frame the situation, then call ask_decision.",
				"ask_decision is the only tool you may call (no text-only replies).",
			].join(" ");
		} else if (decisionSessionPhase === "nudge") {
			promptSections.decision_loop = [
				"Phase: nudge. Goal is unclear.",
				"Call ask_decision proposing a final goal and ask id goal_clear: whether that goal is clear enough to act.",
				"If unclear, Ask phase resumes; if clear, enter Act with a checkbox task list.",
			].join(" ");
		} else if (decisionSessionPhase === "verify") {
			promptSections.decision_loop = [
				"Phase: verify. Call ask_decision with one self-contained yes/no:",
				'"Should we continue fixing / repeat before finishing?" (yes = keep fixing, no = settle).',
				"Include goal, brief steps executed, and honest failures in the question prompt.",
			].join(" ");
		} else if (decisionSessionPhase === "act") {
			promptSections.decision_loop = [
				"Phase: act. You may use Act tools freely; ask_decision is optional for mid-task choices.",
				"On first Act entry, output a markdown checkbox task list (- [ ] …) of the work before other tools.",
				"When finished, stop — the harness will force verify.",
			].join(" ");
		}
		promptSections.ask_decision = [
			"Always use ask_decision for choices — do not reason product/policy decisions in assistant prose, thinking, or act without answers.",
			"In your thought process: describe the situation only; never conclude what to do — ask_decision decides.",
			"In ask/verify phases, ask_decision is the only tool. In act, ask_decision is optional.",
			"",
			"Question rules:",
			"- One concern per question.",
			"- Each prompt must be a complete, self-contained problem: include paths, alternatives, and facts needed to answer.",
			'- The classifier sees harness state only (goal_card, user_request, recent_tools) — not the full transcript. Never assume "as above", prior Q&A, or tool stdout.',
			"- Options: omit for yes/no; for multiple choice provide at least two options. Never a single option.",
			"",
			"Answer routing (harness-owned, not your job to pick):",
			"- In build mode, the harness classifies whether each question is answered by the decision classifier (jev) or shown to the human.",
			"- Human questionnaire is only for preference/policy/priority/approval questions the router assigns to human — it is not the default ask path.",
			"- After plan mode ends, do not behave as if every question is a human questionnaire; most build questions go to jev unless routed to human.",
			"- In plan mode, the same jev-vs-human routing applies to planning questions.",
			"",
			"Example arguments:",
			"",
			"{",
			'  "goal": "Ship safely",',
			'  "questions": [',
			'    { "id": "tests", "prompt": "Should we add unit tests for the login change in src/auth.ts before merging?" },',
			"    {",
			'      "id": "storage",',
			'      "prompt": "Which database should store session tokens for the login change?",',
			'      "options": [',
			'        { "value": "pg", "label": "Postgres" },',
			'        { "value": "sqlite", "label": "SQLite" }',
			"      ]",
			"    }",
			"  ]",
			"}",
			"",
			"Keep state compact: optional verified facts only. Do not dump transcripts or tool stdout.",
			"The tools section lists only tools allowed right now — if write/edit/bash/read are absent, do not call them; call ask_decision instead.",
		].join("\n");
		const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
		if (visibleSkills.length > 0) {
			promptSections.skills =
				'Skills are not listed inline. Ask via ask_decision whether skill guidance would help (e.g. id "skill_help", prompt "Would skill guidance help?"); the harness classifies and injects the best skill. Users can still invoke /skill:name directly.';
		}
	} else if (skillFileReadTool && skills.length > 0) {
		const skillsPrompt = formatSkillsForPrompt(skills, skillFileReadTool).trim();
		if (skillsPrompt) promptSections.skills = skillsPrompt;
	}
	promptSections.cwd = cwd.replace(/\\/g, "/");
	for (const [name, content] of Object.entries(customSections)) {
		if (content) promptSections[name] = content;
	}

	const sections: SystemPromptSections = { preamble: promptSections.preamble };
	for (const [name, content] of Object.entries(promptSections)) {
		if (name !== "preamble") sections[name] = `<${name}>\n${content}\n</${name}>`;
	}
	return sections;
}

/**
 * The complete prompt state for `input`. A forced prompt is opaque and lives in `content`
 * with no sections; otherwise `content` is empty and the structured sections carry the prompt.
 */
export function buildSystemPromptState(input: BuildSystemPromptOptions): {
	content: string;
	sections?: SystemPromptSections;
} {
	if (input.forceSystemPrompt !== undefined) return { content: input.forceSystemPrompt };
	return { content: "", sections: buildSystemPromptSections(input) };
}

/** Build the system prompt text, rendered exactly as the transcript's system message replays it. */
export function buildSystemPrompt(input: BuildSystemPromptOptions): string {
	return getSystemMessageText({ role: "system", ...buildSystemPromptState(input), timestamp: 0 });
}

/**
 * Diff the sections the model currently has (replayed from the transcript, so never null)
 * against the desired ones. Returns a `SystemMessage.sections` patch, or undefined when
 * nothing changed.
 */
export function diffSystemPromptSections(
	previous: Record<string, string | null>,
	current: SystemPromptSections,
): Record<string, string | null> | undefined {
	const patch: Record<string, string | null> = {};
	for (const [name, text] of Object.entries(current)) {
		if (previous[name] !== text) patch[name] = text;
	}
	for (const name of Object.keys(previous)) {
		if (current[name] === undefined) patch[name] = null;
	}
	return Object.keys(patch).length > 0 ? patch : undefined;
}
