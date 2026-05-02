export type AnalysisIntent =
  | 'portfolio_only'
  | 'earnings_analysis'
  | 'company_research'
  | 'macro_analysis'
  | 'strategy_analysis'
  | 'market_research'
  | 'deep_analysis';

const EARNINGS_PATTERNS: RegExp[] = [
  /財報|業績|盈利|收入|營收/,
  /EPS|經營利潤|營業利潤|淨利潤|自由現金流|現金流|資本開支|capex/i,
  /cloud|advertising|guidance|earnings|10-Q|10-K/i,
];

const MACRO_PATTERNS: RegExp[] = [
  /利率|加息|減息|息率/,
  /通脹|CPI|物價/,
  /債息|十年期|treasury/i,
  /美元|匯率|DXY/i,
  /聯儲局|聯準會|FOMC|央行/i,
  /經濟數據|就業|失業率|GDP|政策|宏觀|macro/i,
];

const COMPANY_RESEARCH_PATTERNS: RegExp[] = [
  /商業模式|競爭力|護城河|估值|PE|PB|產品|管理層|CEO|行業地位|市場份額/,
  /增長.*啟示|啟示|公司.*研究|值得.*持有|長線.*價值/,
  /cloud|advertising|AI|YouTube|Search/i,
];

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

const STRATEGY_PATTERNS: RegExp[] = [
  /應唔應該/,
  /應否|可唔可以/,
  /減倉|加倉|離場|入市|止盈|止蝕|止損/,
  /部署|風險控制|長線策略|再平衡|重組|重新.*配置/,
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
  /佔.*組合.*幾多|佔成個組合幾多|組合.*佔比/,
  /股票.*比例|ETF.*比例|債券.*比例/,
  /而家有幾多/,
  /嘅數量|嘅成本|嘅市值/,
];

export function classifyIntent(question: string): AnalysisIntent {
  const normalized = question.trim();

  // Priority matters: earnings and macro questions need specialized evidence and prompts.
  if (EARNINGS_PATTERNS.some((p) => p.test(normalized))) {
    return 'earnings_analysis';
  }
  if (MACRO_PATTERNS.some((p) => p.test(normalized))) {
    return 'macro_analysis';
  }
  if (STRATEGY_PATTERNS.some((p) => p.test(normalized)) || DEEP_ANALYSIS_PATTERNS.some((p) => p.test(normalized))) {
    return 'strategy_analysis';
  }
  if (COMPANY_RESEARCH_PATTERNS.some((p) => p.test(normalized))) {
    return 'company_research';
  }
  if (PORTFOLIO_ONLY_PATTERNS.some((p) => p.test(normalized))) {
    return 'portfolio_only';
  }
  if (MARKET_RESEARCH_PATTERNS.some((p) => p.test(normalized))) {
    return 'company_research';
  }
  // Default: do external search to ground the answer
  return 'company_research';
}

export function intentNeedsExternalSearch(intent: AnalysisIntent): boolean {
  return intent !== 'portfolio_only';
}
