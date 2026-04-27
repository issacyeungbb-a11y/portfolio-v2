export type AnalysisIntent = 'portfolio_only' | 'market_research' | 'deep_analysis';

// Strategic reasoning: "should I", "what if", allocation decisions, recession scenarios
const DEEP_ANALYSIS_PATTERNS: RegExp[] = [
  /應唔應該/,
  /減倉|加倉|離場|入市/,
  /衰退.*影響|如果.*衰退/,
  /結構性問題/,
  /未來.*[三四五六七八九]個月|未來.*半年|未來.*一年/,
  /長遠.*策略|策略.*長遠/,
  /配置.*問題|配置.*改善|配置.*有冇問題/,
  /最需要留意/,
  /組合.*整體風險|整體.*風險/,
  /重組|重新.*配置/,
  /調整持倉|持倉.*調整/,
];

// External data needed: news, macro, rates, company updates, market events
const MARKET_RESEARCH_PATTERNS: RegExp[] = [
  /新聞|消息|公告/,
  /利率|加息|減息|息率/,
  /通脹|CPI|物價/,
  /債息|十年期|treasury/i,
  /美元.*走勢|走勢.*美元/,
  /聯儲局|聯準會|FOMC/i,
  /宏觀|macro/i,
  /近期.*市場|市場.*近期/,
  /政策|監管/,
  /財報|業績|盈利/,
  /IPO|上市/i,
  /估值|PE|PB/i,
  /資金流向/,
  /近期.*有咩|最近.*有咩/,
];

// Portfolio-only: factual queries about current holdings, no external context needed
const PORTFOLIO_ONLY_PATTERNS: RegExp[] = [
  /最大持倉|持倉最大/,
  /加密.*佔|佔.*加密/,
  /成本最高|最高.*成本/,
  /升跌最多|最多.*升跌/,
  /我持有|我.*買咗|我.*賣咗/,
  /幾多.*手|持有.*幾多/,
  /股票.*比例|ETF.*比例|債券.*比例/,
  /而家有幾多/,
  /嘅數量|嘅成本|嘅市值/,
];

export function classifyIntent(question: string): AnalysisIntent {
  if (DEEP_ANALYSIS_PATTERNS.some((p) => p.test(question))) {
    return 'deep_analysis';
  }
  if (MARKET_RESEARCH_PATTERNS.some((p) => p.test(question))) {
    return 'market_research';
  }
  if (PORTFOLIO_ONLY_PATTERNS.some((p) => p.test(question))) {
    return 'portfolio_only';
  }
  // Default: do external search to ground the answer
  return 'market_research';
}

export function intentNeedsExternalSearch(intent: AnalysisIntent): boolean {
  return intent === 'market_research' || intent === 'deep_analysis';
}
