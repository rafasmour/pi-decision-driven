import { type AnyModel, isModelType, type ModelTypeMap } from "@earendil-works/pi-ai";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	Spacer,
	Text,
	type TUI,
} from "@earendil-works/pi-tui";
import { getModelSelectorSearchText } from "../model-search.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

type ClassifierModel = ModelTypeMap["classifier"];

interface ClassifierReference {
	provider: string;
	id: string;
}

export const NO_CLASSIFIERS_MESSAGE =
	"No classifier models are available. Set TYPESAFE_API_KEY (or another provider's key), run /login, or load a classifier on a llama.cpp router with /llama.";

function isSameModel(a: ClassifierReference | undefined, b: ClassifierReference): boolean {
	return a?.provider === b.provider && a.id === b.id;
}

/**
 * Selector for classifier (decision) models, modeled on ModelSelectorComponent.
 * It lists classifier models only; chat and image models are ignored.
 */
export class ClassifierSelectorComponent extends Container implements Focusable {
	private searchInput: Input;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	private listContainer: Container;
	private allModels: ClassifierModel[];
	private filteredModels: ClassifierModel[];
	private selectedIndex = 0;
	private currentModel?: ClassifierReference;
	private defaultModel?: ClassifierReference;
	private onSelectCallback: (model: ClassifierModel) => void;
	private onSelectAsDefaultCallback?: (model: ClassifierModel) => void;
	private onCancelCallback: () => void;
	private tui: TUI;

	constructor(
		tui: TUI,
		currentModel: ClassifierReference | undefined,
		models: readonly AnyModel[],
		onSelect: (model: ClassifierModel) => void,
		onCancel: () => void,
		initialSearchInput?: string,
		onSelectAsDefault?: (model: ClassifierModel) => void,
		defaultModel?: ClassifierReference,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.defaultModel = defaultModel;
		this.onSelectCallback = onSelect;
		this.onSelectAsDefaultCallback = onSelectAsDefault;
		this.onCancelCallback = onCancel;
		this.allModels = this.sortModels(
			models.filter((model): model is ClassifierModel => isModelType(model, "classifier")),
		);
		this.filteredModels = this.allModels;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg("warning", "Classifier models decide; they do not chat. /model still selects the chat model."),
				0,
				0,
			),
		);
		this.addChild(new Spacer(1));

		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			const selected = this.filteredModels[this.selectedIndex];
			if (selected) this.onSelectCallback(selected);
		};
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		if (this.onSelectAsDefaultCallback) {
			this.addChild(
				new Text(
					theme.fg(
						"dim",
						`  ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("app.models.save")} to set as default · ${keyDisplayText("tui.select.cancel")} to cancel`,
					),
					0,
					0,
				),
			);
		}
		this.addChild(new DynamicBorder());

		const currentIndex = this.allModels.findIndex((model) => isSameModel(this.currentModel, model));
		this.selectedIndex = currentIndex >= 0 ? currentIndex : 0;
		if (initialSearchInput) this.filterModels(initialSearchInput);
		else this.updateList();
		this.tui.requestRender();
	}

	/** Models currently shown, after search filtering. */
	getVisibleModels(): readonly ClassifierModel[] {
		return this.filteredModels;
	}

	private sortModels(models: ClassifierModel[]): ClassifierModel[] {
		// Current model first, default model second, then by provider.
		return [...models].sort((a, b) => {
			const aIsCurrent = isSameModel(this.currentModel, a);
			const bIsCurrent = isSameModel(this.currentModel, b);
			if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1;
			const aIsDefault = isSameModel(this.defaultModel, a);
			const bIsDefault = isSameModel(this.defaultModel, b);
			if (aIsDefault !== bIsDefault) return aIsDefault ? -1 : 1;
			return a.provider.localeCompare(b.provider);
		});
	}

	private filterModels(query: string): void {
		if (query) {
			this.filteredModels = fuzzyFilter(this.allModels, query, (model) => {
				const defaultText = isSameModel(this.defaultModel, model) ? " default" : "";
				return `${getModelSelectorSearchText({ id: model.id, provider: model.provider, name: model.name })}${defaultText}`;
			});
		} else {
			this.filteredModels = this.allModels;
		}
		this.selectedIndex = query ? 0 : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filteredModels.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.filteredModels.length);

		for (let i = startIndex; i < endIndex; i++) {
			const model = this.filteredModels[i];
			if (!model) continue;

			const isSelected = i === this.selectedIndex;
			const isCurrent = isSameModel(this.currentModel, model);
			const defaultBadge = isSameModel(this.defaultModel, model) ? theme.fg("muted", " · default") : "";
			const cursor = isSelected ? theme.fg("accent", "→ ") : "  ";
			const currentMarker = isCurrent ? theme.fg("accent", "✓ ") : "  ";
			const modelText = isSelected ? theme.fg("accent", model.id) : model.id;
			const providerBadge = theme.fg("muted", `[${model.provider}]`);
			this.listContainer.addChild(
				new Text(`${cursor}${currentMarker}${modelText} ${providerBadge}${defaultBadge}`, 0, 0),
			);
		}

		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredModels.length})`), 0, 0),
			);
		}

		if (this.allModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("warning", `  ${NO_CLASSIFIERS_MESSAGE}`), 0, 0));
		} else if (this.filteredModels.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching classifier models"), 0, 0));
		} else {
			const selected = this.filteredModels[this.selectedIndex];
			if (selected) {
				this.listContainer.addChild(new Spacer(1));
				this.listContainer.addChild(new Text(theme.fg("muted", `  Model Name: ${selected.name}`), 0, 0));
			}
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.down")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			const selected = this.filteredModels[this.selectedIndex];
			if (selected) this.onSelectCallback(selected);
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		} else if (kb.matches(keyData, "app.models.save") && this.onSelectAsDefaultCallback) {
			const selected = this.filteredModels[this.selectedIndex];
			if (selected) this.onSelectAsDefaultCallback(selected);
		} else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
