import { setKeybindings, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { ClassifierSelectorComponent } from "../src/modes/interactive/components/classifier-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const tui = { requestRender: () => {} } as unknown as TUI;

describe("classifier selector", () => {
	let harness: Harness | undefined;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	async function createClassifierHarness(settings = {}): Promise<Harness> {
		harness = await createHarness({ settings });
		await harness.session.modelRuntime.setRuntimeApiKey("typesafe", "sk-typesafe");
		return harness;
	}

	it("lists classifier models only", async () => {
		const h = await createClassifierHarness();
		const classifiers = await h.session.modelRuntime.getAvailableOfType("classifier");
		expect(classifiers.length).toBeGreaterThan(0);

		// Hand the selector a mix of chat and classifier models.
		const selector = new ClassifierSelectorComponent(
			tui,
			undefined,
			[...h.models, ...classifiers],
			() => {},
			() => {},
		);

		const visible = selector.getVisibleModels();
		expect(visible.map((model) => `${model.provider}/${model.id}`).sort()).toEqual(
			classifiers.map((model) => `${model.provider}/${model.id}`).sort(),
		);
		expect(visible.every((model) => model.type === "classifier")).toBe(true);

		const text = stripAnsi(selector.render(120).join("\n"));
		expect(text).toContain("jev-latest");
		for (const chat of h.models) expect(text).not.toContain(`${chat.id} [`);
	});

	it("shows setup guidance when no classifier is available", async () => {
		const h = await createClassifierHarness();
		const selector = new ClassifierSelectorComponent(
			tui,
			undefined,
			h.models,
			() => {},
			() => {},
		);
		expect(selector.getVisibleModels()).toEqual([]);
		expect(stripAnsi(selector.render(200).join("\n"))).toContain("TYPESAFE_API_KEY");
	});

	it("selects on enter and saves the default on the save key", async () => {
		const h = await createClassifierHarness();
		const classifiers = await h.session.modelRuntime.getAvailableOfType("classifier");
		const selected: string[] = [];
		const saved: string[] = [];
		const selector = new ClassifierSelectorComponent(
			tui,
			undefined,
			classifiers,
			(model) => selected.push(`${model.provider}/${model.id}`),
			() => {},
			undefined,
			(model) => saved.push(`${model.provider}/${model.id}`),
		);

		selector.handleInput("\r");
		selector.handleInput("\x13"); // ctrl+s, the default app.models.save binding

		const first = `${classifiers[0].provider}/${classifiers[0].id}`;
		expect(selected).toEqual([first]);
		expect(saved).toEqual([first]);
	});

	it("session classifier overrides the saved default and persists on request", async () => {
		const h = await createClassifierHarness();
		const [first] = await h.session.modelRuntime.getAvailableOfType("classifier");
		// Built-in OpenRouter free default applies until a session pick or saved override.
		expect(h.session.classifierModel?.id).toBe("inception/mercury-decide:free");

		await h.session.setClassifierModel(first);
		expect(h.session.classifierModel).toBe(first);
		expect(h.settingsManager.getGlobalSettings().defaultClassifierModel).toBeUndefined();

		await h.session.setClassifierModel(first, { persist: true });
		expect(h.settingsManager.getDefaultClassifierProvider()).toBe(first.provider);
		expect(h.settingsManager.getDefaultClassifierModel()).toBe(first.id);
	});

	it("rejects chat models and models without auth", async () => {
		harness = await createHarness();
		await expect(harness.session.setClassifierModel(harness.models[0])).rejects.toThrow("not a classifier model");

		const jev = harness.session.modelRuntime.getModelOfType("classifier", "typesafe", "jev-latest")!;
		await expect(harness.session.setClassifierModel(jev)).rejects.toThrow("No API key");
	});

	it("resolves the saved default classifier when none was picked", async () => {
		const h = await createClassifierHarness({
			defaultClassifierProvider: "typesafe",
			defaultClassifierModel: "jev-latest",
		});
		expect(h.session.classifierModel?.id).toBe("jev-latest");
	});

	it("falls back to the built-in OpenRouter free classifier when no default is saved", async () => {
		const h = await createClassifierHarness();
		expect(h.settingsManager.getGlobalSettings().defaultClassifierProvider).toBeUndefined();
		expect(h.session.classifierModel?.provider).toBe("openrouter");
		expect(h.session.classifierModel?.id).toBe("inception/mercury-decide:free");
	});
});

describe("classifier default settings", () => {
	it("defaults to OpenRouter free mercury-decide when unset", () => {
		const settings = SettingsManager.inMemory();
		expect(settings.getDefaultClassifierProvider()).toBe("openrouter");
		expect(settings.getDefaultClassifierModel()).toBe("inception/mercury-decide:free");
		expect(settings.getGlobalSettings().defaultClassifierProvider).toBeUndefined();
		expect(settings.getGlobalSettings().defaultClassifierModel).toBeUndefined();
	});

	it("round-trips defaultClassifierProvider and defaultClassifierModel", () => {
		const settings = SettingsManager.inMemory();
		settings.setDefaultClassifierAndProvider("typesafe", "jev-latest");

		expect(settings.getDefaultClassifierProvider()).toBe("typesafe");
		expect(settings.getDefaultClassifierModel()).toBe("jev-latest");
		expect(settings.getGlobalSettings()).toMatchObject({
			defaultClassifierProvider: "typesafe",
			defaultClassifierModel: "jev-latest",
		});
	});

	it("is read from stored settings", () => {
		const settings = SettingsManager.inMemory({
			defaultClassifierProvider: "openrouter",
			defaultClassifierModel: "typesafe/jev-1.13",
		});
		expect(settings.getDefaultClassifierProvider()).toBe("openrouter");
		expect(settings.getDefaultClassifierModel()).toBe("typesafe/jev-1.13");
	});
});
