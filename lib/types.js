import { HarnessError } from "@deepseek-ai/dsh-llm";
//#region src/types.ts
/**
* Vocabulary for the RAGFlow knowledge-base retrieval capability seam
* (`ctx.ragflow`): the request and result shapes, the provider contract, and
* the error taxonomy. Providers and consumers depend only on this module, never
* on each other.
* @module @deepseek-ai/dsh-ragflow/types
*/
/**
* Typed RAGFlow error with a machine-routable, open-string `code` and chained
* `cause`. Shared codes cover unavailable, missing, unusable, ambiguous, or
* duplicate providers, cancellation, missing credentials, missing search scope,
* and provider failure. Tool execution exposes the code in structured error
* metadata.
*/
var RagflowError = class extends HarnessError {};
//#endregion
export { RagflowError as t };
