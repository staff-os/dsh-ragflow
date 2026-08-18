import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { Service } from "@deepseek-ai/cordis";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/types.ts
/**

* Typed RAGFlow error with a machine-routable `code` and chained `cause`.

*/
var RagflowError = class extends HarnessError {};

//#endregion
//#region src/runtime.ts
/**

* The RAGFlow knowledge-base retrieval service. Registered as `ctx.ragflow`.

*/
var RagflowRuntime = class extends Service {
	static Config = z.object({ retrieveProvider: z.string() });
	retrieveProviders = /* @__PURE__ */ new Map();
	retrieveProviderId;
	constructor(ctx, config = {}) {
		super(ctx, "ragflow");
		this.retrieveProviderId = config.retrieveProvider ?? process.env.DSH_RAGFLOW_PROVIDER;
	}
	/**
	
	* Register a retrieval provider. Returns a disposer.
	
	*/
	registerRetrieveProvider(provider) {
		return this.registerProvider(this.retrieveProviders, provider);
	}
	registerProvider(store, provider) {
		if (store.has(provider.id)) throw new RagflowError(`a ragflow provider with id "${provider.id}" is already registered`, "RAGFLOW_DUPLICATE_PROVIDER");
		const dispose = this.ctx.effect(function* () {
			store.set(provider.id, provider);
			yield () => store.delete(provider.id);
		}, "ragflow.registerProvider()");
		return () => void dispose();
	}
	/**
	
	* Run one retrieval through the selected provider.
	
	*/
	async retrieve(request, signal) {
		const provider = resolveProvider({
			providers: this.retrieveProviders,
			...this.retrieveProviderId !== void 0 ? { configuredId: this.retrieveProviderId } : {}
		});
		const result = await provider.retrieve(request, signal);
		return capChunks(result, request.topK);
	}
};
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
function capChunks(result, topK) {
	if (topK === void 0 || result.chunks.length <= topK) return result;
	return {
		...result,
		chunks: result.chunks.slice(0, topK),
		truncated: true
	};
}

//#endregion
//#region src/provider.ts
/** Stable id this provider registers under. */
const RAGFLOW_PROVIDER_ID = "ragflow";
/** Default RAGFlow API endpoint base. */
const RAGFLOW_DEFAULT_BASE_URL = "http://localhost:9380";
/** Default number of chunks to retrieve per request. */
const RAGFLOW_DEFAULT_TOP_K = 10;
/** Default similarity threshold; chunks below this score are filtered. */
const RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD = .2;
/** Attribution header sent on every request. */
const USER_AGENT = "dsh-ragflow/0.1.0";
/**

* Map one RAGFlow API chunk to a normalized chunk, or `undefined` when it

* carries no content.

*/
function mapRagflowChunk(chunk) {
	const content = chunk.content?.trim();
	if (content === void 0 || content.length === 0) return void 0;
	return {
		content,
		datasetId: chunk.dataset_id ?? "",
		documentId: chunk.document_id ?? "",
		...chunk.document_name != null && chunk.document_name.length > 0 ? { documentName: chunk.document_name } : {},
		...chunk.similarity != null ? { similarity: chunk.similarity } : {},
		...chunk.document_metadata != null && Object.keys(chunk.document_metadata).length > 0 ? { documentMetadata: chunk.document_metadata } : {}
	};
}
/**

* Map a RAGFlow retrieval response to a normalized retrieval result.

*/
function mapRagflowResponse(response, similarityThreshold) {
	const rawChunks = response.chunks;
	if (rawChunks === void 0 || Object.keys(rawChunks).length === 0) throw new RagflowError("RAGFlow returned no chunks; the retrieval may not have matched any documents", "RAGFLOW_PROVIDER_ERROR");
	const chunks = [];
	for (const key of Object.keys(rawChunks)) {
		const raw = rawChunks[key];
		if (raw === void 0) continue;
		const mapped = mapRagflowChunk(raw);
		if (mapped === void 0) continue;
		if (mapped.similarity !== void 0 && mapped.similarity < similarityThreshold) continue;
		chunks.push(mapped);
	}
	return {
		chunks,
		truncated: false
	};
}
/** The RAGFlow-backed retrieval provider. */
var RagflowProvider = class {
	id = RAGFLOW_PROVIDER_ID;
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}
	available() {
		const options = this.resolveOptions();
		return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0) && URL.canParse(options.baseURL) && options.similarityThreshold >= 0;
	}
	async retrieve(request, signal) {
		const options = this.resolveOptions();
		const apiKey = await this.resolveApiKey(options, signal);
		throwIfAborted(signal);
		const endpoint = `${options.baseURL}/api/v1/retrieval`;
		const datasetIds = request.datasetIds ?? options.datasetIds;
		const topK = request.topK ?? options.topK;
		const body = {
			question: request.question,
			...datasetIds !== void 0 && datasetIds.length > 0 ? { dataset_ids: datasetIds } : {},
			...topK !== void 0 ? { top_k: topK } : {},
			similarity_threshold: options.similarityThreshold
		};
		throwIfAborted(signal);
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					"authorization": `Bearer ${apiKey}`,
					"content-type": "application/json",
					"accept": "application/json",
					"user-agent": USER_AGENT
				},
				body: JSON.stringify(body),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw retrieveAborted(signal, error);
			throw new RagflowError(`RAGFlow retrieval request failed: ${String(error)}`, "RAGFLOW_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			const status = response.status;
			let message = `RAGFlow API error (HTTP ${status})`;
			try {
				const parsed = await response.json();
				const detail = parsed.message ?? (typeof parsed.code === "number" ? `code ${parsed.code}` : void 0);
				if (detail !== void 0 && detail.length > 0) message = detail;
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw retrieveAborted(signal, error);
			}
			throw new RagflowError(message, "RAGFLOW_PROVIDER_ERROR");
		}
		try {
			const payload = await response.json();
			return mapRagflowResponse(payload, options.similarityThreshold);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw retrieveAborted(signal, error);
			if (error instanceof RagflowError) throw error;
			throw new RagflowError(`RAGFlow returned an unprocessable response body: ${String(error)}`, "RAGFLOW_PROVIDER_ERROR", { cause: error });
		}
	}
	async resolveApiKey(options, signal) {
		throwIfAborted(signal);
		if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
		let resolved;
		try {
			resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(void 0), signal);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw retrieveAborted(signal, error);
			throw new RagflowError(`RAGFlow credential resolution failed: ${String(error)}`, "RAGFLOW_PROVIDER_ERROR", { cause: error });
		}
		if (resolved !== void 0 && resolved.length > 0) return resolved;
		const ref = options.apiKeyEnv ?? "RAGFLOW_API_KEY";
		throw new RagflowError(`RAGFlow retrieval has no API key for "${ref}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the config`, "RAGFLOW_PROVIDER_CREDENTIAL_MISSING");
	}
};
function abortable(operation, signal) {
	if (signal === void 0) return operation;
	if (signal.aborted) return Promise.reject(retrieveAborted(signal));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(retrieveAborted(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(new Error(String(error).replace(/^Error: /u, ""), { cause: error }));
		});
	});
}
function throwIfAborted(signal) {
	if (signal?.aborted === true) throw retrieveAborted(signal);
}
function retrieveAborted(signal, fallback) {
	return new RagflowError("RAGFlow retrieval aborted", "RAGFLOW_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}

//#endregion
//#region src/tool.ts
/** Default upper bound on returned chunks. */
const RAGFLOW_RETRIEVE_DEFAULT_TOP_K = 10;
/** Default cooperative tool-call timeout budget (ms). */
const DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS = 3e4;
/**

* Validate value constraints the schema DSL can't express: a non-blank

* `question`.

*/
function parseRetrieveArgs(args) {
	if (args.question.trim().length === 0) throw new Error("question must be a non-empty string");
	return { question: args.question };
}
/**

* Format a retrieval result as one model-facing text block.

*/
function formatRetrieveOutput(result) {
	const parts = [];
	if (result.chunks.length > 0) {
		const lines = result.chunks.map((chunk, index) => {
			const label = chunk.documentName ?? chunk.documentId;
			const meta = [];
			if (chunk.similarity !== void 0) meta.push(`similarity: ${chunk.similarity.toFixed(4)}`);
			const suffix = meta.length > 0 ? ` — ${meta.join(", ")}` : "";
			return `### ${index + 1}. ${label}${suffix}\n\n${chunk.content}`;
		});
		parts.push(`Retrieved chunks:\n\n${lines.join("\n\n---\n\n")}`);
	} else parts.push("No relevant chunks found.");
	if (result.truncated) parts.push(`(Showing the first ${result.chunks.length} chunks. Refine the question for more.)`);
	parts.push("Cite the relevant document names and chunk content above in your answer.");
	return parts.join("\n\n");
}
/** Pending-call presentation. */
function presentRetrieveCall(args) {
	return {
		card: "generic",
		title: args.question,
		kind: "search",
		rawInput: args.question
	};
}
/** Project one seam chunk into a plain object that omits every absent optional field. */
function projectChunk(chunk) {
	return {
		content: chunk.content,
		datasetId: chunk.datasetId,
		documentId: chunk.documentId,
		...chunk.documentName !== void 0 ? { documentName: chunk.documentName } : {},
		...chunk.similarity !== void 0 ? { similarity: chunk.similarity } : {}
	};
}
/** Project a validated output value into its replayable presentation meta. */
function retrieveMetaFromValue(value) {
	return {
		chunks: value.chunks.map(projectChunk),
		truncated: value.truncated
	};
}
/**

* Register the `ragflow_retrieve` tool and its system-prompt guidance.

*/
function applyRagflowRetrieveTool(ctx, topK, timeoutMs, datasetIds) {
	ctx.systemPrompt.section({
		name: "tool:ragflow_retrieve",
		order: 110,
		text: "Use the ragflow_retrieve tool to search connected RAGFlow knowledge bases for relevant information. It returns chunks of text from uploaded documents with similarity scores. Use the retrieved content to answer questions grounded in your knowledge base, and cite the document names in your answer."
	});
	const ragflow = ctx.ragflow;
	ctx.tools.register(defineTool({
		name: "ragflow_retrieve",
		description: "Retrieve relevant knowledge chunks from connected RAGFlow knowledge bases. Returns text chunks from documents with similarity scores and source metadata.",
		parameters: { question: {
			type: "string",
			required: true,
			description: "The natural-language question to retrieve relevant knowledge for."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					chunks: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								content: {
									type: "string",
									required: true
								},
								datasetId: {
									type: "string",
									required: true
								},
								documentId: {
									type: "string",
									required: true
								},
								documentName: { type: "string" },
								similarity: { type: "number" }
							}
						}
					},
					truncated: {
						type: "boolean",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: formatRetrieveOutput(value)
			}],
			presentationMeta: (_args, value) => retrieveMetaFromValue(value)
		},
		timeoutMs,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const input = parseRetrieveArgs(args);
			const result = await ragflow.retrieve({
				question: input.question,
				topK,
				...datasetIds !== void 0 && datasetIds.length > 0 ? { datasetIds } : {}
			}, exec.signal);
			return {
				chunks: result.chunks.map(projectChunk),
				truncated: result.truncated
			};
		},
		presentCall: presentRetrieveCall,
		presentResult: (args, result) => {
			if (result.isError) return void 0;
			return {
				card: "generic",
				kind: "search",
				title: args.question,
				rawInput: args.question
			};
		}
	}));
}

//#endregion
//#region src/index.ts
/** Cordis plugin name used by loader diagnostics. */
const name = "ragflow";
/** Services required by this plugin. */
const inject = ["tools", "systemPrompt"];
/** Environment variable names. */
const DEFAULT_API_KEY_ENV = "RAGFLOW_API_KEY";
const RAGFLOW_BASE_URL_ENV = "RAGFLOW_BASE_URL";
const Config = z.object({
	apiKey: z.string().role("secret"),
	apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	baseURL: z.string(),
	datasetIds: z.array(z.string()),
	topK: z.number().step(1).min(1),
	similarityThreshold: z.number().min(0).max(1),
	retrieveTopK: z.number().step(1).min(1).default(RAGFLOW_RETRIEVE_DEFAULT_TOP_K),
	retrieveTimeoutMs: z.number().step(1).min(1).default(DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS)
});
/**

* Resolve provider options from config and environment.

*/
function resolveProviderOptions(ctx, config) {
	const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
	const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
	return {
		...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
		resolveApiKey: async () => {
			const credentials = ctx.get("credentials");
			if (credentials !== void 0) return (await credentials.resolve(apiKeyEnv))?.value;
			const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
			return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
		},
		apiKeyEnv,
		baseURL: config.baseURL ?? launchEnvironmentOf(ctx).get(RAGFLOW_BASE_URL_ENV)?.value ?? RAGFLOW_DEFAULT_BASE_URL,
		...config.datasetIds !== void 0 && config.datasetIds.length > 0 ? { datasetIds: config.datasetIds } : {},
		...config.topK !== void 0 ? { topK: config.topK } : { topK: RAGFLOW_DEFAULT_TOP_K },
		similarityThreshold: config.similarityThreshold ?? RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD
	};
}
/**

* Register the RAGFlow capability seam, the HTTP API provider, and the

* `ragflow_retrieve` model-facing tool. All three are effect-scoped and

* unregister on plugin dispose.

*/
function apply(ctx, config) {
	ctx.plugin(RagflowRuntime, {});
	ctx.ragflow.registerRetrieveProvider(new RagflowProvider(() => resolveProviderOptions(ctx, config)));
	const retrieveTopK = config.retrieveTopK ?? RAGFLOW_RETRIEVE_DEFAULT_TOP_K;
	const retrieveTimeoutMs = config.retrieveTimeoutMs ?? DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS;
	const datasetIds = config.datasetIds;
	applyRagflowRetrieveTool(ctx, retrieveTopK, retrieveTimeoutMs, datasetIds);
}

//#endregion
export { Config, DEFAULT_RAGFLOW_TOOL_TIMEOUT_MS, RAGFLOW_DEFAULT_BASE_URL, RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD, RAGFLOW_DEFAULT_TOP_K, RAGFLOW_PROVIDER_ID, RAGFLOW_RETRIEVE_DEFAULT_TOP_K, RagflowError, RagflowProvider, RagflowRuntime, apply, applyRagflowRetrieveTool, formatRetrieveOutput, inject, name, parseRetrieveArgs, presentRetrieveCall, retrieveMetaFromValue };