import { readFileSync } from "node:fs";
import type { ClassifierContext, ClassifierModel } from "@earendil-works/pi-ai";
import { stripFrontmatter } from "../../utils/frontmatter.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import type { Skill } from "../skills.ts";

export function formatSkillPickerContext(skills: Skill[]): ClassifierContext {
	return {
		state: { phase: "skill_picker" },
		questions: {
			pick: {
				type: "choice",
				instructions: "Which skill best matches the current task?",
				criteria: Object.fromEntries(
					skills
						.filter((s) => !s.disableModelInvocation)
						.map((skill) => [skill.name, `${skill.name}: ${skill.description}`]),
				),
			},
		},
	};
}

export async function pickSkillWithClassifier(
	skills: Skill[],
	runtime: ModelRuntime,
	model: ClassifierModel<any>,
	signal?: AbortSignal,
): Promise<Skill | undefined> {
	const visible = skills.filter((s) => !s.disableModelInvocation);
	if (visible.length === 0) return undefined;
	if (visible.length === 1) return visible[0];

	const context = formatSkillPickerContext(visible);
	const result = await runtime.classify(model, context, { signal });
	if (result.stopReason !== "stop") return undefined;
	const pick = result.answers.pick;
	if (pick?.type === "choice") {
		return visible.find((skill) => skill.name === pick.choice);
	}
	return undefined;
}

export function renderSkillInjection(skill: Skill): string {
	const content = readFileSync(skill.filePath, "utf-8");
	const body = stripFrontmatter(content).trim();
	return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}
