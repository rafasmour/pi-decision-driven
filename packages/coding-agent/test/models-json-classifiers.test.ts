import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryModelsStore, isModelType } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

describe("models.json classifier models", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("loads custom classifier definitions for /classifier", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-models-json-classifier-"));
		tempDirs.push(dir);
		const modelsPath = join(dir, "models.json");
		writeFileSync(
			modelsPath,
			JSON.stringify({
				providers: {
					"local-decisions": {
						baseUrl: "https://decisions.example/v1",
						apiKey: "test-key",
						models: [
							{
								type: "classifier",
								id: "routing-v1",
								name: "Routing classifier",
								api: "typesafe-system-one",
								contextWindow: 8192,
							},
						],
					},
				},
			}),
		);

		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsStore: new InMemoryModelsStore(),
			modelsPath,
			allowModelNetwork: false,
		});

		const classifier = runtime.getModelOfType("classifier", "local-decisions", "routing-v1");
		expect(classifier).toBeDefined();
		expect(classifier?.type).toBe("classifier");
		expect(classifier?.api).toBe("typesafe-system-one");
		expect(runtime.getModel("local-decisions", "routing-v1")).toBeUndefined();
		expect(runtime.getModels("local-decisions")).toEqual([]);
		expect(await runtime.getAvailableOfType("classifier", "local-decisions")).toEqual([classifier]);
		expect(isModelType(classifier!, "classifier")).toBe(true);
		expect(runtime.getAllModels("local-decisions").map((model) => model.id)).toEqual(["routing-v1"]);

		const provider = runtime.getProviders().find((entry) => entry.id === "local-decisions");
		expect(provider?.classify).toBeTypeOf("function");
	});
});
