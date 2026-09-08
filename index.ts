/**
 * Hide HuggingFace Models Extension
 *
 * Problem: pi shows ALL huggingface models as "available" as soon as
 * HF_TOKEN exists in the environment, even if the token doesn't have
 * access to those models. HuggingFace is a marketplace — one token
 * doesn't mean access to all models. pi's model visibility is
 * provider-granular (has token -> all models visible), but HF is a
 * marketplace (one token != all models accessible).
 *
 * Solution: This extension patches the model registry/runtime so
 * huggingface models are excluded wherever pi lists "available" models
 * — /model selector, Ctrl+P cycling, exact-model search, etc.
 *
 * Why three layers are patched:
 *   - ctx.modelRegistry is a *facade* (ModelRegistry) whose getAvailable()
 *     just forwards to the internal ModelRuntime. pi's own UI (the /model
 *     selector, model cycling, footer provider count) reads
 *     modelRuntime.getAvailableSnapshot() DIRECTLY and never touches the
 *     facade. Patching only the facade therefore has no visible effect.
 *   - So we also patch the shared ModelRuntime instance that the facade
 *     wraps (reached via registry.runtime) — that is the object the UI
 *     actually reads from. This makes hiding effective in the TUI.
 *   - Finally we stop pi from auto-fetching the huggingface remote model
 *     catalog (pi.dev/api/models/providers/huggingface) into
 *     models-store.json: its refreshModels is disabled and any persisted
 *     huggingface entry is removed, so HF model info is neither downloaded
 *     nor stored even though HF_TOKEN is present.
 *
 * Configuration via environment variables:
 *   HF_HIDE_MODELS=1          -- Hide all HF models (default if HF_TOKEN is set)
 *   HF_HIDE_MODELS=0          -- Don't hide (show HF models normally)
 *   HF_ALLOWED_MODELS=comma,separated,model,ids -- Only hide models NOT in this list
 *   HF_UNSET_TOKEN=1          -- Also unset HF_TOKEN from env (affects --list-models too)
 *
 * If neither HF_HIDE_MODELS nor HF_TOKEN is set, the extension does nothing.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "huggingface";

// State: whether hiding is currently active
let hidingActive = false;

function shouldHide(): boolean {
	const envVal = process.env.HF_HIDE_MODELS;
	if (envVal === "0") return false;
	if (envVal === "1") return true;
	// Default: hide if HF_TOKEN is set
	return !!process.env.HF_TOKEN;
}

function shouldUnsetToken(): boolean {
	return process.env.HF_UNSET_TOKEN === "1";
}

function getAllowedModels(): Set<string> {
	const raw = process.env.HF_ALLOWED_MODELS;
	if (!raw) return new Set();
	return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/** Build a fresh filtered copy of a model list according to current state. */
function filterModels(models: readonly any[]): any[] {
	if (!hidingActive) return [...models];
	const allowed = getAllowedModels();
	return models.filter((m: any) => {
		if (!m || m.provider !== PROVIDER) return true;
		if (allowed.size > 0 && allowed.has(m.id)) return true;
		return false;
	});
}

async function installPatch(ctx: any) {
	const shouldHideNow = shouldHide();
	hidingActive = shouldHideNow;

	if (!shouldHideNow) return;

	const registry = ctx.modelRegistry;
	if (!registry) return;

	// Optionally unset HF_TOKEN from process.env
	if (shouldUnsetToken() && process.env.HF_TOKEN) {
		delete process.env.HF_TOKEN;
	}

	// --- Layer 1: patch the ModelRegistry facade (getAvailable) ---
	// Kept for anything that reads through the extension-facing facade.
	const method = registry.getAvailable;
	if (typeof method === "function" && !(method as any).__hideHfPatched) {
		const origGetAvailable = method.bind(registry);
		const patchedGetAvailable: any = function () {
			return filterModels(origGetAvailable());
		};
		patchedGetAvailable.__hideHfPatched = true;
		registry.getAvailable = patchedGetAvailable;
	}

	// --- Layer 2: patch the shared ModelRuntime that pi's UI actually reads ---
	// ModelRegistry is only a compatibility facade ("coding-agent internals use
	// ModelRuntime directly"); the /model selector and model cycling call
	// modelRuntime.getAvailableSnapshot() directly. The facade exposes the
	// underlying runtime as its `runtime` property, so we patch that instance.
	const runtime = registry.runtime;
	if (runtime) {
		// Sync snapshot read — used by ModelSelectorComponent, cycling, footer, etc.
		const snapshotMethod = runtime.getAvailableSnapshot;
		if (
			typeof snapshotMethod === "function" &&
			!(runtime as any).__hideHfSnapshotPatched
		) {
			const origSnapshot = snapshotMethod.bind(runtime);
			const patchedSnapshot: any = function () {
				return filterModels(origSnapshot());
			};
			(runtime as any).__hideHfSnapshotPatched = true;
			runtime.getAvailableSnapshot = patchedSnapshot;
		}

		// Async refresh read — used by exact-match search and CLI-style lookups.
		const asyncMethod = runtime.getAvailable;
		if (
			typeof asyncMethod === "function" &&
			!(runtime as any).__hideHfAvailablePatched
		) {
			const origAvailable = asyncMethod.bind(runtime);
			const patchedAvailable: any = async function (
				providerId?: string,
				options?: any,
			) {
				return filterModels(await origAvailable(providerId, options));
			};
			(runtime as any).__hideHfAvailablePatched = true;
			runtime.getAvailable = patchedAvailable;
		}
	}

	// --- Layer 3: stop pi from auto-fetching the HF model catalog into
	// models-store.json (pi.dev/api/models/providers/huggingface) and drop the
	// entry pi already persisted there. Without this, a network refresh runs
	// whenever the cached entry is stale (>4h) or missing — downloading HF
	// model info on every start even though we hide it from the UI.
	if (runtime) {
		const models = (runtime as any).models; // internal ModelsImpl
		if (models) {
			const provider = models.getProvider?.(PROVIDER);
			if (provider && typeof provider.refreshModels === "function") {
				// Cancel any in-flight refresh generation so its queued persist
				// cannot re-create the entry after we delete it.
				models.supersedeProviderRefresh?.(PROVIDER);
				provider.refreshModels = async () => {};
			}
			const store = (models as any).modelsStore; // FileModelsStore
			if (store && typeof store.delete === "function") {
				try {
					await store.delete(PROVIDER);
				}
				catch {
					// Best-effort cleanup; refresh is disabled regardless.
				}
			}
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event: any, ctx: any) => {
		await installPatch(ctx);
	});
}
