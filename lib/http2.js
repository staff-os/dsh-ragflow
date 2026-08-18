import { t as Schema } from "./lib.js";
import { t as RagflowError } from "./types.js";
import { t as RAGFLOW_HTTP_SETTINGS_NAMESPACE } from "./settings.js";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { installSettingsSection } from "@deepseek-ai/dsh-settings";
//#region src/provider.ts
/** Stable id this provider registers under. */
const RAGFLOW_PROVIDER_ID = "ragflow-http";
/** Default RAGFlow API endpoint base for a local deployment. */
const RAGFLOW_DEFAULT_BASE_URL = "http://localhost:9380";
/** Default similarity threshold; RAGFlow's own default for `/api/v1/retrieval`. */
const RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD = .2;
/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = "dsh-ragflow/0.2.0";
/** The retrieval operation appended to the configured base URL. */
const RETRIEVAL_PATH = "/api/v1/retrieval";
/** First non-blank string among the candidates, else `undefined`. */
function firstNonBlank(...candidates) {
	for (const candidate of candidates) if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
}
/**
* Map one RAGFlow API chunk to a normalized chunk, or `undefined` when it
* carries no content (an empty chunk has nothing citable, and inventing text
* would make the seam lie).
*
* Field names differ across RAGFlow versions and surfaces — `content_with_weight`,
* `kb_id`, `doc_id`, and `docnm_kwd` are the legacy spellings of `content`,
* `dataset_id`, `document_id`, and `document_keyword`, and the Python SDK
* normalizes the last one to `document_name` — so every spelling is accepted.
*
* @param chunk - one entry of the response's `data.chunks[]`.
* @returns the normalized chunk, or `undefined` when it has no content.
*/
function mapRagflowChunk(chunk) {
	const content = firstNonBlank(chunk.content, chunk.content_with_weight)?.trim();
	if (content === void 0) return void 0;
	const chunkId = firstNonBlank(chunk.id, chunk.chunk_id);
	const documentName = firstNonBlank(chunk.document_keyword, chunk.document_name, chunk.docnm_kwd);
	return {
		content,
		datasetId: firstNonBlank(chunk.dataset_id, chunk.kb_id) ?? "",
		documentId: firstNonBlank(chunk.document_id, chunk.doc_id) ?? "",
		...chunkId !== void 0 ? { chunkId } : {},
		...documentName !== void 0 ? { documentName } : {},
		...typeof chunk.similarity === "number" ? { similarity: chunk.similarity } : {}
	};
}
/**
* Map a RAGFlow response envelope to a normalized retrieval result.
*
* A zero-chunk response is a legitimate outcome ("nothing in the knowledge base
* matched"), not an error: the consumer renders it as such.
*
* @param envelope - the parsed `POST /api/v1/retrieval` response body.
* @returns the normalized result; content-less entries are dropped.
* @throws {RagflowError} `RAGFLOW_PROVIDER_ERROR` when `code` is non-zero.
*/
function mapRagflowResponse(envelope) {
	if (envelope.code !== void 0 && envelope.code !== 0) {
		const detail = firstNonBlank(envelope.message) ?? `code ${envelope.code}`;
		throw new RagflowError(`RAGFlow retrieval failed: ${detail}`, "RAGFLOW_PROVIDER_ERROR");
	}
	return {
		chunks: (envelope.data?.chunks ?? []).map(mapRagflowChunk).filter((chunk) => chunk !== void 0),
		truncated: false
	};
}
/**
* Build the `POST /api/v1/retrieval` request body from a seam request and the
* provider's configured defaults. A request's own scope wins over the
* configured scope as a whole, so a caller narrowing to one dataset does not
* silently inherit configured document ids.
*
* @param request - the seam-level retrieval request.
* @param options - the resolved provider options.
* @returns the RAGFlow request body.
* @throws {RagflowError} `RAGFLOW_SCOPE_MISSING` when neither dataset nor
*   document ids are known — RAGFlow requires at least one.
*/
function buildRetrievalBody(request, options) {
	const requestScoped = (request.datasetIds?.length ?? 0) > 0 || (request.documentIds?.length ?? 0) > 0;
	const datasetIds = requestScoped ? request.datasetIds ?? [] : options.datasetIds ?? [];
	const documentIds = requestScoped ? request.documentIds ?? [] : options.documentIds ?? [];
	if (datasetIds.length === 0 && documentIds.length === 0) throw new RagflowError("RAGFlow retrieval needs at least one dataset id or document id; set \"datasetIds\" in the provider config or export $RAGFLOW_DATASET_IDS", "RAGFLOW_SCOPE_MISSING");
	return {
		question: request.question,
		...datasetIds.length > 0 ? { dataset_ids: [...datasetIds] } : {},
		...documentIds.length > 0 ? { document_ids: [...documentIds] } : {},
		similarity_threshold: options.similarityThreshold,
		...request.maxChunks !== void 0 ? {
			page: 1,
			page_size: request.maxChunks
		} : {},
		...options.vectorTopK !== void 0 ? { top_k: options.vectorTopK } : {},
		...options.vectorSimilarityWeight !== void 0 ? { vector_similarity_weight: options.vectorSimilarityWeight } : {},
		...options.keyword !== void 0 ? { keyword: options.keyword } : {},
		...options.rerankId !== void 0 && options.rerankId.length > 0 ? { rerank_id: options.rerankId } : {}
	};
}
/** The RAGFlow-HTTP-backed retrieval provider; HTTP redirects fail as `RAGFLOW_PROVIDER_ERROR`. */
var RagflowHttpProvider = class {
	resolveOptions;
	id = RAGFLOW_PROVIDER_ID;
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}
	available() {
		const options = this.resolveOptions();
		return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== void 0) && URL.canParse(options.baseURL) && options.similarityThreshold >= 0 && options.similarityThreshold <= 1 && (options.vectorTopK === void 0 || isPositiveInteger(options.vectorTopK));
	}
	async retrieve(request, signal) {
		const options = this.resolveOptions();
		const body = buildRetrievalBody(request, options);
		const apiKey = await this.resolveApiKey(options, signal);
		throwIfAborted(signal);
		let response;
		try {
			response = await fetch(`${options.baseURL}${RETRIEVAL_PATH}`, {
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
			if (isAborted(signal, error)) throw retrieveAborted(signal, error);
			throw new RagflowError(`RAGFlow retrieval request failed: ${String(error)}`, "RAGFLOW_PROVIDER_ERROR", { cause: error });
		}
		let envelope;
		try {
			envelope = await response.json();
		} catch (error) {
			if (isAborted(signal, error)) throw retrieveAborted(signal, error);
			if (!response.ok) throw new RagflowError(`RAGFlow API error (HTTP ${response.status})`, httpErrorCode(response.status), { cause: error });
			throw new RagflowError(`RAGFlow returned an unprocessable response body: ${String(error)}`, "RAGFLOW_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			const detail = firstNonBlank(envelope.message);
			throw new RagflowError(detail ?? `RAGFlow API error (HTTP ${response.status})`, httpErrorCode(response.status));
		}
		return mapRagflowResponse(envelope);
	}
	async resolveApiKey(options, signal) {
		throwIfAborted(signal);
		if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
		let resolved;
		try {
			resolved = await options.resolveApiKey?.();
		} catch (error) {
			if (isAborted(signal, error)) throw retrieveAborted(signal, error);
			throw new RagflowError(`RAGFlow credential resolution failed: ${String(error)}`, "RAGFLOW_PROVIDER_ERROR", { cause: error });
		}
		if (resolved !== void 0 && resolved.length > 0) return resolved;
		const ref = options.apiKeyEnv ?? "RAGFLOW_API_KEY";
		throw new RagflowError(`RAGFlow retrieval has no API key for "${ref}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the config`, "RAGFLOW_PROVIDER_CREDENTIAL_MISSING");
	}
};
/** An authentication failure is worth its own code; everything else is generic. */
function httpErrorCode(status) {
	return status === 401 || status === 403 ? "RAGFLOW_PROVIDER_UNAUTHORIZED" : "RAGFLOW_PROVIDER_ERROR";
}
function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}
function throwIfAborted(signal) {
	if (signal?.aborted === true) throw retrieveAborted(signal);
}
function isAborted(signal, error) {
	return signal?.aborted === true || error instanceof DOMException && error.name === "AbortError";
}
function retrieveAborted(signal, fallback) {
	return new RagflowError("RAGFlow retrieval aborted", "RAGFLOW_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
//#endregion
//#region src/http.ts
/** Cordis plugin name used by loader diagnostics. */
const name = "ragflow-http";
/** The RAGFlow seam this provider registers into. */
const inject = ["ragflow"];
/** Credential reference resolved when no literal `apiKey` is configured. */
const DEFAULT_API_KEY_ENV = "RAGFLOW_API_KEY";
/** Launch-environment variable naming the endpoint base. */
const BASE_URL_ENV = "RAGFLOW_BASE_URL";
/** Launch-environment variable naming the default datasets (comma-separated). */
const DATASET_IDS_ENV = "RAGFLOW_DATASET_IDS";
const Config = Schema.object({
	apiKey: Schema.string().role("secret"),
	apiKeyEnv: Schema.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	baseURL: Schema.string(),
	datasetIds: Schema.array(Schema.string()),
	documentIds: Schema.array(Schema.string()),
	similarityThreshold: Schema.number().min(0).max(1).default(RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD),
	vectorTopK: Schema.number().step(1).min(1),
	vectorSimilarityWeight: Schema.number().min(0).max(1),
	keyword: Schema.boolean(),
	rerankId: Schema.string()
});
/** Split a comma-separated environment value into non-blank ids. */
function parseIdList(raw) {
	if (raw === void 0) return [];
	return raw.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
}
/**
* Resolve provider options from config and the launch environment. Called per
* retrieval so a credential or environment change takes effect without a
* reload; the provider snapshots it once per operation.
*
* @param ctx - the plugin context (owns the credentials seam and launch env).
* @param config - the schema-validated plugin config.
* @returns the fully resolved provider options.
*/
function resolveProviderOptions(ctx, config) {
	const env = launchEnvironmentOf(ctx);
	const apiKeyEnv = credentialRef(config.apiKeyEnv ?? "RAGFLOW_API_KEY");
	const datasetIds = config.datasetIds !== void 0 && config.datasetIds.length > 0 ? config.datasetIds : parseIdList(env.get(DATASET_IDS_ENV)?.value);
	return {
		...config.apiKey !== void 0 && config.apiKey.length > 0 ? { apiKey: config.apiKey } : {},
		resolveApiKey: async () => {
			const credentials = ctx.get("credentials");
			if (credentials !== void 0) return (await credentials.resolve(apiKeyEnv))?.value;
			const ambient = env.get(apiKeyEnv);
			return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
		},
		apiKeyEnv,
		baseURL: config.baseURL ?? env.get("RAGFLOW_BASE_URL")?.value ?? "http://localhost:9380",
		...datasetIds.length > 0 ? { datasetIds } : {},
		...config.documentIds !== void 0 && config.documentIds.length > 0 ? { documentIds: config.documentIds } : {},
		similarityThreshold: config.similarityThreshold ?? .2,
		...config.vectorTopK !== void 0 ? { vectorTopK: config.vectorTopK } : {},
		...config.vectorSimilarityWeight !== void 0 ? { vectorSimilarityWeight: config.vectorSimilarityWeight } : {},
		...config.keyword !== void 0 ? { keyword: config.keyword } : {},
		...config.rerankId !== void 0 && config.rerankId.length > 0 ? { rerankId: config.rerankId } : {}
	};
}
/**
* Register the RAGFlow HTTP retrieval provider with `ctx.ragflow`. The
* registration is an effect owned by this plugin's fiber, so an HMR reload or
* an uninstall unregisters it without manual teardown.
*
* The authoritative config is a thunk, not the entry object: while a settings
* provider is mounted, `installSettingsSection` points it at the resolved
* `ragflow-http` section, so a value saved in the configuration page reaches
* the NEXT retrieval without a reload. Options are resolved per operation
* already, so nothing here needs to react to a change.
*/
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, RAGFLOW_HTTP_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	ctx.ragflow.registerRetrieveProvider(new RagflowHttpProvider(() => resolveProviderOptions(ctx, current())));
}
//#endregion
export { apply as a, parseIdList as c, RAGFLOW_DEFAULT_SIMILARITY_THRESHOLD as d, RAGFLOW_PROVIDER_ID as f, mapRagflowResponse as g, mapRagflowChunk as h, DEFAULT_API_KEY_ENV as i, resolveProviderOptions as l, buildRetrievalBody as m, Config as n, inject as o, RagflowHttpProvider as p, DATASET_IDS_ENV as r, name as s, BASE_URL_ENV as t, RAGFLOW_DEFAULT_BASE_URL as u };
