export { ContextManagerImpl, type ContextManagerConfig } from "./manager.js";
export { Externalizer } from "./externalizer.js";
export { Compactor } from "./compactor.js";
export { HandoffGenerator } from "./handoff.js";
export {
  classifyTier,
  shouldExternalize,
  createExternalizedPlaceholder,
  isExternalizedPlaceholder,
  extractRefId,
} from "./tiers.js";
