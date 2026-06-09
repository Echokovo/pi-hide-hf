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
 * Solution: This extension patches ModelRegistry.getAvailable() to
 * exclude huggingface models, so they never appear in /model or the
 * model selector.
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

function installPatch(ctx: any) {
	const shouldHideNow = shouldHide();
	hidingActive = shouldHideNow;

	if (!shouldHideNow) return;

	const registry = ctx.modelRegistry;

	// Optionally unset HF_TOKEN from process.env
	if (shouldUnsetToken() && process.env.HF_TOKEN) {
		delete process.env.HF_TOKEN;
		console.log("[hide-hf] Unset HF_TOKEN from environment");
	}

	// --- Patch getAvailable() ---
	const method = registry.getAvailable;
	if (typeof method === "function" && !(method as any).__hideHfPatched) {
		const origGetAvailable = method.bind(registry);
		const patchedGetAvailable: any = function () {
			const allModels = origGetAvailable();
			if (!hidingActive) return allModels;
			const allowed = getAllowedModels();
			return allModels.filter((m: any) => {
				if (m.provider !== PROVIDER) return true;
				if (allowed.size > 0 && allowed.has(m.id)) return true;
				return false;
			});
		};
		patchedGetAvailable.__hideHfPatched = true;
		registry.getAvailable = patchedGetAvailable;
	}

	console.log("[hide-hf] Patched getAvailable() to hide HF models");
}



export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event: any, ctx: any) => {
		installPatch(ctx);
	});
}
