export const GEMINI_ANALYZE_MODEL = (process.env.GEMINI_ANALYZE_MODEL?.trim() || 'gemini-3.1-pro-preview');
export const CLAUDE_ANALYZE_MODEL = (process.env.CLAUDE_ANALYZE_MODEL?.trim() || 'claude-opus-4-7');
export const GROUNDED_GEMINI_MODEL = process.env.GROUNDED_GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
export const DEFAULT_ANALYSIS_MODEL = (process.env.DEFAULT_ANALYSIS_MODEL?.trim() || 'gemini-3.1-pro-preview');
const GROUNDED_SEARCH_FALLBACK_MODELS = ['gemini-2.5-pro', 'gemini-3.1-pro-preview'];
export const MODEL_REGISTRY = {
    'gemini-3.1-pro-preview': {
        provider: 'google',
        label: 'Google Gemini 3.1 Pro Preview',
    },
    'claude-opus-4-7': {
        provider: 'anthropic',
        label: 'Claude Opus 4.7',
    },
};
export function resolveModelProvider(model) {
    return MODEL_REGISTRY[model]?.provider ?? 'google';
}
export function isValidAnalysisModel(model) {
    return typeof model === 'string' && model in MODEL_REGISTRY;
}
export function getSearchModelCandidates() {
    const preferred = GROUNDED_GEMINI_MODEL;
    const fallbacks = [...GROUNDED_SEARCH_FALLBACK_MODELS].filter((m) => m !== preferred);
    return [preferred, ...fallbacks];
}
