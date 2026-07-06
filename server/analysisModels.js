const GEMINI_ANALYZE_MODEL = process.env.GEMINI_ANALYZE_MODEL?.trim() || "gemini-3.1-pro-preview";
const CLAUDE_ANALYZE_MODEL = process.env.CLAUDE_ANALYZE_MODEL?.trim() || "claude-opus-4-8";
const GROUNDED_GEMINI_MODEL = process.env.GROUNDED_GEMINI_MODEL?.trim() || "gemini-2.5-flash";
const DEFAULT_ANALYSIS_MODEL = process.env.DEFAULT_ANALYSIS_MODEL?.trim() || "gemini-3.1-pro-preview";
const GROUNDED_SEARCH_FALLBACK_MODELS = ["gemini-2.5-pro", "gemini-3.1-pro-preview"];
const MODEL_REGISTRY = {
  "gemini-3.1-pro-preview": {
    provider: "google",
    label: "Google Gemini 3.1 Pro Preview"
  },
  "claude-opus-4-8": {
    provider: "anthropic",
    label: "Claude Opus 4.8"
  }
};
function resolveModelProvider(model) {
  return MODEL_REGISTRY[model]?.provider ?? "google";
}
function isValidAnalysisModel(model) {
  return typeof model === "string" && model in MODEL_REGISTRY;
}
function getSearchModelCandidates() {
  const preferred = GROUNDED_GEMINI_MODEL;
  const fallbacks = [...GROUNDED_SEARCH_FALLBACK_MODELS].filter((m) => m !== preferred);
  return [preferred, ...fallbacks];
}
export {
  CLAUDE_ANALYZE_MODEL,
  DEFAULT_ANALYSIS_MODEL,
  GEMINI_ANALYZE_MODEL,
  GROUNDED_GEMINI_MODEL,
  MODEL_REGISTRY,
  getSearchModelCandidates,
  isValidAnalysisModel,
  resolveModelProvider
};
