//#region src/invariant.ts
const PACKAGE_NAME = "@deepseek-ai/dsh-ragflow";
/** Cordis companion plugin name. */
const name = "ragflow-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: provider maps are private and selection/result caps
* are enforced on each call.
*/
const install = () => {};
/**
* Register this package's invariant companion.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
