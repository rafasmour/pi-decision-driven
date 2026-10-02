import { describe, expect, it } from "vitest";
import { buildDecisionTurnMessages } from "../src/core/decision/decision-follow-up.ts";
import { DECISION_BLOCK_FENCE, parseDecisionBlockFromText } from "../src/core/decision/parse-decision-block.ts";
import { toClassifierContext, toDecisionRequest } from "../src/core/decision/questionnaire.ts";
import type { Skill } from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

const testSkill: Skill = {
	name: "release",
	description: "Release workflow",
	filePath: "/skills/release/SKILL.md",
	baseDir: "/skills/release",
	sourceInfo: createSyntheticSourceInfo("/skills/release/SKILL.md", { source: "test" }),
	disableModelInvocation: false,
};

describe("parseDecisionBlockFromText", () => {
	it("parses a decisions fenced JSON block", () => {
		const text = `Planning next step.

${DECISION_BLOCK_FENCE}
{
  "goal": "Ship safely",
  "questions": [
    { "id": "go", "prompt": "Proceed?" },
    {
      "id": "db",
      "prompt": "Storage",
      "options": [
        { "value": "pg", "label": "Postgres" },
        { "value": "sqlite", "label": "SQLite" }
      ]
    }
  ]
}
\`\`\``;

		const batch = parseDecisionBlockFromText(text);
		expect(batch?.goal).toBe("Ship safely");
		expect(batch?.questions).toHaveLength(2);
		const context = toClassifierContext(batch!);
		expect(context.questions.go?.type).toBe("bool");
		expect(context.questions.db?.type).toBe("choice");
	});

	it("maps yes/no option pairs to bool questions", () => {
		const batch = parseDecisionBlockFromText(`${DECISION_BLOCK_FENCE}
{"questions":[{"id":"x","prompt":"Continue?","options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]}]}
\`\`\``);
		expect(toClassifierContext(batch!).questions.x?.type).toBe("bool");
	});

	it("merges batch.goal into classifier state.goal", () => {
		const context = toClassifierContext({
			goal: "Ship the feature",
			state: { turn: 1 },
			questions: [{ id: "go", prompt: "Proceed?" }],
		});
		expect(context.state).toMatchObject({ turn: 1, goal: "Ship the feature" });
	});
});

describe("decision follow-up messages", () => {
	it("builds U1 card payloads and a user summary", async () => {
		const batch = parseDecisionBlockFromText(`${DECISION_BLOCK_FENCE}
{"questions":[{"id":"go","prompt":"Proceed?"}]}
\`\`\``)!;
		const messages = await buildDecisionTurnMessages(
			batch,
			{ go: { type: "bool", probability: 0.91 } },
			{ skills: [], modelRuntime: {} as never },
		);
		expect(messages).toHaveLength(3);
		expect(messages[0].role).toBe("custom");
		expect(messages[2].role).toBe("user");
		expect(toDecisionRequest(batch).questions[0]?.kind).toBe("bool");
	});
});

describe("decision-driven system prompt (S4)", () => {
	it("documents the decisions block and omits the skill index", () => {
		const prompt = buildSystemPrompt({
			decisionDriven: true,
			selectedTools: ["read"],
			toolSnippets: { read: "Read files" },
			skills: [testSkill],
			contextFiles: [],
			cwd: "/tmp",
		});

		expect(prompt).toContain("decision-driven harness");
		expect(prompt).toContain("(1) ask");
		expect(prompt).toContain("<decisions_format>");
		expect(prompt).toContain(DECISION_BLOCK_FENCE);
		expect(prompt).not.toContain("<available_skills>");
		expect(prompt).toContain("skill_help");
	});

	it("keeps the inline skill index when decision mode is off", () => {
		const prompt = buildSystemPrompt({
			selectedTools: ["read"],
			skills: [testSkill],
			contextFiles: [],
			cwd: "/tmp",
		});
		expect(prompt).toContain("<available_skills>");
	});
});

describe("classify mapping", () => {
	it("uses questionsToClassifierContext for parsed batches", () => {
		const batch = parseDecisionBlockFromText(`${DECISION_BLOCK_FENCE}
{"questions":[{"id":"go","prompt":"Proceed?"}]}
\`\`\``)!;
		const context = toClassifierContext(batch);
		expect(context.questions.go).toEqual(
			expect.objectContaining({ type: "bool", instructions: "Proceed?" }),
		);
	});
});
