import { t as Schema } from "./lib.js";
import { t as RagflowError } from "./types.js";
import { Service } from "@deepseek-ai/cordis";
//#region src/index.ts
/**
* Service Definition for the RAGFlow knowledge-base retrieval capability seam
* (`ctx.ragflow`): the provider registry and provider-selecting execution for
* retrieval. Duplicate ids are rejected. At execution time a configured
* provider must exist and be usable; without one, exactly one usable provider
* is required, so selection never depends on registration order.
*
* This module owns the `ctx.ragflow` key and nothing else — no HTTP, no tool.
* The provider lives in `@deepseek-ai/dsh-ragflow/http`, the model-facing tool
* in `@deepseek-ai/dsh-ragflow/tool`.
*
* @module @deepseek-ai/dsh-ragflow
*/
/**
* The RAGFlow knowledge-base retrieval service. Registered as `ctx.ragflow`
* (one instance per context).
*
* Selection semantics (resolved at execution time, never order-dependent):
* - A configured id that is registered and `available()` → that provider.
* - A configured id not registered → `RAGFLOW_PROVIDER_CONFIGURED_MISSING`.
* - A configured id registered but unavailable →
*   `RAGFLOW_PROVIDER_CONFIGURED_UNAVAILABLE`.
* - No id configured, exactly one registered usable provider → that provider.
* - No id configured, multiple usable providers → `RAGFLOW_PROVIDER_AMBIGUOUS`.
* - No id configured, no usable provider → `RAGFLOW_PROVIDER_UNAVAILABLE`.
*/
var RagflowRuntime = class extends Service {
	/**
	* Provider selection config. The operational env override feeds the SAME
	* field: `$DSH_RAGFLOW_PROVIDER` is equivalent to `retrieveProvider` and is
	* NOT a hidden priority chain.
	*/
	static Config = Schema.object({ retrieveProvider: Schema.string() });
	retrieveProviders = /* @__PURE__ */ new Map();
	retrieveProviderId;
	constructor(ctx, config = {}) {
		super(ctx, "ragflow");
		this.retrieveProviderId = config.retrieveProvider ?? process.env.DSH_RAGFLOW_PROVIDER;
	}
	/**
	* Register a retrieval provider. Throws {@link RagflowError}
	* `RAGFLOW_DUPLICATE_PROVIDER` if its id is already registered. Returns a
	* disposer; disposed with the calling fiber.
	* @param provider - the provider; its `id` is the registry key.
	* @returns the disposer that unregisters the provider.
	*/
	registerRetrieveProvider(provider) {
		if (this.retrieveProviders.has(provider.id)) throw new RagflowError(`a ragflow provider with id "${provider.id}" is already registered`, "RAGFLOW_DUPLICATE_PROVIDER");
		const store = this.retrieveProviders;
		const dispose = this.ctx.effect(function* () {
			store.set(provider.id, provider);
			yield () => store.delete(provider.id);
		}, "ragflow.registerRetrieveProvider()");
		return () => void dispose();
	}
	/**
	* Run one retrieval through the selected provider. Resolves the provider at
	* call time with the selection rules above; throws {@link RagflowError} when
	* the capability cannot run. The seam enforces `request.maxChunks` on the
	* result: if the provider over-returns, `chunks[]` is truncated and
	* `truncated` set. An empty result is not an error.
	* @param request - the question, optional scope, and optional result bound.
	* @param signal - optional cancellation signal forwarded to the provider.
	* @returns the provider's chunks, capped to `request.maxChunks`.
	*/
	async retrieve(request, signal) {
		return capChunks(await resolveProvider({
			providers: this.retrieveProviders,
			...this.retrieveProviderId !== void 0 ? { configuredId: this.retrieveProviderId } : {}
		}).retrieve(request, signal), request.maxChunks);
	}
};
/** Resolve the selected provider or throw the matching {@link RagflowError}. */
function resolveProvider(selection) {
	const { configuredId, providers } = selection;
	if (configuredId !== void 0) {
		const provider = providers.get(configuredId);
		if (!provider) throw new RagflowError(`configured ragflow provider "${configuredId}" is not registered`, "RAGFLOW_PROVIDER_CONFIGURED_MISSING");
		if (!provider.available()) throw new RagflowError(`configured ragflow provider "${configuredId}" is registered but unavailable`, "RAGFLOW_PROVIDER_CONFIGURED_UNAVAILABLE");
		return provider;
	}
	const usable = [...providers.values()].filter((provider) => provider.available());
	const [single] = usable;
	if (single === void 0) throw new RagflowError("no usable ragflow provider is registered", "RAGFLOW_PROVIDER_UNAVAILABLE");
	if (usable.length > 1) {
		const ids = usable.map((provider) => provider.id).join(", ");
		throw new RagflowError(`multiple usable ragflow providers are registered (${ids}); configure one explicitly`, "RAGFLOW_PROVIDER_AMBIGUOUS");
	}
	return single;
}
/** Enforce `maxChunks` on a retrieval result: truncate `chunks[]` and flag it. */
function capChunks(result, maxChunks) {
	if (maxChunks === void 0 || result.chunks.length <= maxChunks) return result;
	return {
		...result,
		chunks: result.chunks.slice(0, maxChunks),
		truncated: true
	};
}
//#endregion
export { RagflowError, RagflowRuntime, RagflowRuntime as default, capChunks };
