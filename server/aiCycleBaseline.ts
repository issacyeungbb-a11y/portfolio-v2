// 內置基準讀數：部署後尚未成功讀取每週訊號檔時使用，頁面會標明並非最新。
// 由監察系統於 2026-11-14 以實時市場數據產生（scripts.export_signal），已刪去逐隻股票及來源明細。
// 更新方法：重新執行監察系統的匯出指令，再以新的 signal.json 取代以下內容。

import type { AiCycleSignal } from '../src/types/aiCycle';

export const AI_CYCLE_BASELINE_SIGNAL = {
  "schema_version": 1,
  "methodology_version": "SIGNAL_V0_1",
  "formal_methodology_versions": {
    "ami": "AMI_V0_1",
    "abri": "ABRI_V0_1",
    "cycle": "CYCLE_V0_1"
  },
  "generated_at": "2026-11-14T14:16:38+00:00",
  "as_of_date": "2026-11-14",
  "latest_completed_quarter": "2026-Q3",
  "ami": {
    "score": 63.9,
    "weight_covered": 0.4,
    "pillars_used": [
      "AI_INFRASTRUCTURE_MONETIZATION",
      "CLOUD_PLATFORM_MONETIZATION",
      "MONETIZATION_BREADTH"
    ],
    "pillars_not_used": [
      {
        "code": "MODEL_MONETIZATION",
        "label_zh": "模型變現",
        "base_weight": 0.1,
        "reason_zh": "沒有合資格數據"
      },
      {
        "code": "AI_APPLICATION_MONETIZATION",
        "label_zh": "應用層變現",
        "base_weight": 0.2,
        "reason_zh": "數據不足，未達最少公司數目或覆蓋要求"
      },
      {
        "code": "ENTERPRISE_ECONOMIC_VALUE",
        "label_zh": "企業經濟價值",
        "base_weight": 0.3,
        "reason_zh": "個案太少且全部來自供應商自行發布的成功案例，分數不具代表性（現有 4 個合資格個案、4 間企業）"
      }
    ],
    "null_reason_zh": null,
    "uses_tier2": false,
    "change_2q": 3.9,
    "change_4q": null,
    "momentum": "RISING",
    "formal_score": null,
    "formal_status": "INSUFFICIENT_COVERAGE",
    "formal_data_coverage": 0.4825,
    "label_zh": "變現指數"
  },
  "abri": {
    "score": 54.7,
    "weight_covered": 0.45,
    "pillars_used": [
      "VALUATION_SPECULATIVE_CAPITAL",
      "LEVERAGE_FINANCING_FRAGILITY",
      "LIQUIDITY_RISK_APPETITE"
    ],
    "pillars_not_used": [
      {
        "code": "CAPITAL_OVERBUILD",
        "label_zh": "資本過度建設",
        "base_weight": 0.25,
        "reason_zh": "數據不足，未達最少公司數目或覆蓋要求"
      },
      {
        "code": "INVESTMENT_MONETIZATION_IMBALANCE",
        "label_zh": "投資與變現失衡",
        "base_weight": 0.2,
        "reason_zh": "數據不足，未達最少公司數目或覆蓋要求"
      },
      {
        "code": "SUPPLY_DEMAND_SLACK",
        "label_zh": "供求鬆緊",
        "base_weight": 0.1,
        "reason_zh": "沒有合資格數據"
      }
    ],
    "null_reason_zh": null,
    "uses_tier2": false,
    "change_2q": -5.6,
    "change_4q": 0.7,
    "momentum": "FALLING",
    "formal_score": null,
    "formal_status": "INSUFFICIENT_COVERAGE",
    "formal_data_coverage": 0.4413,
    "label_zh": "泡沫風險指數"
  },
  "cycle": {
    "candidate_state": "TRANSITION",
    "confirmed_state": "TRANSITION",
    "state": "TRANSITION",
    "consecutive_candidate_quarters": 3,
    "rules_triggered": [],
    "candidate_state_zh": "過渡期（未符合任何單一階段的規則）",
    "formal_state": null,
    "formal_status": "INSUFFICIENT_COVERAGE",
    "basis": "PROVISIONAL"
  },
  "stance": {
    "code": "HOLD",
    "label_zh": "持有觀望",
    "level": 0,
    "base_level": 0,
    "pulse_adjustment": 0,
    "confidence": "LOW",
    "confidence_zh": "低",
    "reasons_zh": [
      "變現指數 63.9、泡沫風險指數 54.7，未符合加碼或減碼條件"
    ],
    "confidence_notes_zh": [
      "兩個指數的已覆蓋權重最低為 40%",
      "變現指數缺少下游（應用層或企業）證據，只反映上游變現",
      "基本面數據已過期，信心下調一級"
    ],
    "caps_zh": []
  },
  "pillars": {
    "ami": [
      {
        "code": "AI_INFRASTRUCTURE_MONETIZATION",
        "label_zh": "基建變現",
        "base_weight": 0.15,
        "score": 70.9,
        "coverage": 0.6667,
        "status": "VALID",
        "source_tier": 1,
        "input_count": 3,
        "entity_count": 3,
        "used_in_provisional": true,
        "not_used_reason_zh": null
      },
      {
        "code": "CLOUD_PLATFORM_MONETIZATION",
        "label_zh": "雲端平台變現",
        "base_weight": 0.15,
        "score": 58.0,
        "coverage": 0.9167,
        "status": "VALID",
        "source_tier": 1,
        "input_count": 6,
        "entity_count": 4,
        "used_in_provisional": true,
        "not_used_reason_zh": null
      },
      {
        "code": "MODEL_MONETIZATION",
        "label_zh": "模型變現",
        "base_weight": 0.1,
        "score": null,
        "coverage": 0.0,
        "status": "NULL",
        "source_tier": 1,
        "input_count": 0,
        "entity_count": 0,
        "used_in_provisional": false,
        "not_used_reason_zh": "沒有合資格數據"
      },
      {
        "code": "AI_APPLICATION_MONETIZATION",
        "label_zh": "應用層變現",
        "base_weight": 0.2,
        "score": null,
        "coverage": 0.175,
        "status": "LOW_COVERAGE",
        "source_tier": 1,
        "input_count": 2,
        "entity_count": 1,
        "used_in_provisional": false,
        "not_used_reason_zh": "數據不足，未達最少公司數目或覆蓋要求"
      },
      {
        "code": "ENTERPRISE_ECONOMIC_VALUE",
        "label_zh": "企業經濟價值",
        "base_weight": 0.3,
        "score": 100.0,
        "coverage": 0.5,
        "status": "VALID",
        "source_tier": 1,
        "input_count": 4,
        "entity_count": 4,
        "used_in_provisional": false,
        "not_used_reason_zh": "個案太少且全部來自供應商自行發布的成功案例，分數不具代表性（現有 4 個合資格個案、4 間企業）"
      },
      {
        "code": "MONETIZATION_BREADTH",
        "label_zh": "變現廣度",
        "base_weight": 0.1,
        "score": 65.5,
        "coverage": 0.6,
        "status": "VALID",
        "source_tier": 1,
        "input_count": 10,
        "entity_count": 9,
        "used_in_provisional": true,
        "not_used_reason_zh": null
      }
    ],
    "abri": [
      {
        "code": "CAPITAL_OVERBUILD",
        "label_zh": "資本過度建設",
        "base_weight": 0.25,
        "score": null,
        "coverage": 0.225,
        "status": "LOW_COVERAGE",
        "source_tier": 1,
        "input_count": 4,
        "entity_count": 2,
        "used_in_provisional": false,
        "not_used_reason_zh": "數據不足，未達最少公司數目或覆蓋要求"
      },
      {
        "code": "INVESTMENT_MONETIZATION_IMBALANCE",
        "label_zh": "投資與變現失衡",
        "base_weight": 0.2,
        "score": null,
        "coverage": 0.25,
        "status": "LOW_COVERAGE",
        "source_tier": 1,
        "input_count": 2,
        "entity_count": 2,
        "used_in_provisional": false,
        "not_used_reason_zh": "數據不足，未達最少公司數目或覆蓋要求"
      },
      {
        "code": "VALUATION_SPECULATIVE_CAPITAL",
        "label_zh": "估值與投機資本",
        "base_weight": 0.2,
        "score": 56.2,
        "coverage": 0.6875,
        "status": "VALID",
        "source_tier": 1,
        "input_count": 14,
        "entity_count": 8,
        "used_in_provisional": true,
        "not_used_reason_zh": null
      },
      {
        "code": "LEVERAGE_FINANCING_FRAGILITY",
        "label_zh": "槓桿與融資脆弱度",
        "base_weight": 0.15,
        "score": 51.1,
        "coverage": 0.65,
        "status": "VALID",
        "source_tier": 1,
        "input_count": 16,
        "entity_count": 8,
        "used_in_provisional": true,
        "not_used_reason_zh": null
      },
      {
        "code": "LIQUIDITY_RISK_APPETITE",
        "label_zh": "流動性與風險胃納",
        "base_weight": 0.1,
        "score": 56.0,
        "coverage": 1.0,
        "status": "VALID",
        "source_tier": 1,
        "input_count": 4,
        "entity_count": 4,
        "used_in_provisional": true,
        "not_used_reason_zh": null
      },
      {
        "code": "SUPPLY_DEMAND_SLACK",
        "label_zh": "供求鬆緊",
        "base_weight": 0.1,
        "score": null,
        "coverage": 0.0,
        "status": "NULL",
        "source_tier": 1,
        "input_count": 0,
        "entity_count": 0,
        "used_in_provisional": false,
        "not_used_reason_zh": "沒有合資格數據"
      }
    ]
  },
  "pulse": {
    "status": "OK",
    "as_of": "2026-11-14",
    "basket": {
      "ticker_count": 13,
      "as_of": "2026-11-13",
      "median_return_4w": -0.0225,
      "median_return_13w": -0.0264,
      "median_drawdown_from_high": 0.1964,
      "median_return_since_reference": -0.087,
      "reference_date": "2026-09-30",
      "share_positive_13w": 0.4615
    },
    "macro": [
      {
        "code": "HIGH_YIELD_OAS",
        "series_id": "BAMLH0A0HYM2",
        "label_zh": "美國高收益債信貸息差",
        "unit": "percent",
        "value": 3.2,
        "date": "2026-11-12",
        "change_4w": -0.05
      },
      {
        "code": "TREASURY_10Y_YIELD",
        "series_id": "DGS10",
        "label_zh": "美國十年期國債孳息率",
        "unit": "percent",
        "value": 5.1,
        "date": "2026-11-12",
        "change_4w": -0.09
      },
      {
        "code": "FED_FUNDS_RATE",
        "series_id": "DFF",
        "label_zh": "聯邦基金有效利率",
        "unit": "percent",
        "value": 3.88,
        "date": "2026-11-12",
        "change_4w": 0.0
      }
    ],
    "flags": [],
    "failures": []
  },
  "freshness": {
    "fundamentals_latest_period_end": "2026-07-31",
    "fundamentals_latest_information_date": "2026-08-27",
    "companies_total": 13,
    "companies_current": 3,
    "current_share": 0.2308,
    "current_window_days": 135,
    "stale": true,
    "stale_reason_zh": "13 間公司中只有 3 間有最近 135 日內結束的季度數據，其餘公司的最新業績尚未入庫",
    "last_source_retrieved_at": "2026-09-07T08:26:12+00:00"
  },
  "history": [
    {
      "as_of_date": "2022-03-31",
      "period": "2022-Q1",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.0,
      "abri_weight_covered": 0.0,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2022-06-30",
      "period": "2022-Q2",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.1,
      "abri_weight_covered": 0.0,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2022-09-30",
      "period": "2022-Q3",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.1,
      "abri_weight_covered": 0.0,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2022-12-31",
      "period": "2022-Q4",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.1,
      "abri_weight_covered": 0.0,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2023-03-31",
      "period": "2023-Q1",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.1,
      "abri_weight_covered": 0.0,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2023-06-30",
      "period": "2023-Q2",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.0,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2023-09-30",
      "period": "2023-Q3",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.15,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2023-12-31",
      "period": "2023-Q4",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.15,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2024-03-31",
      "period": "2024-Q1",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.15,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2024-06-30",
      "period": "2024-Q2",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.15,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2024-09-30",
      "period": "2024-Q3",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.15,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2024-12-31",
      "period": "2024-Q4",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.25,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2025-03-31",
      "period": "2025-Q1",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.25,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2025-06-30",
      "period": "2025-Q2",
      "ami": null,
      "abri": null,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.25,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2025-09-30",
      "period": "2025-Q3",
      "ami": null,
      "abri": 50.2,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.45,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2025-12-31",
      "period": "2025-Q4",
      "ami": null,
      "abri": 54.0,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.45,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2026-03-31",
      "period": "2026-Q1",
      "ami": null,
      "abri": 51.4,
      "ami_weight_covered": 0.25,
      "abri_weight_covered": 0.45,
      "candidate_state": null,
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2026-06-30",
      "period": "2026-Q2",
      "ami": 60.9,
      "abri": 59.6,
      "ami_weight_covered": 0.4,
      "abri_weight_covered": 0.45,
      "candidate_state": "TRANSITION",
      "formal_ami": null,
      "formal_abri": null
    },
    {
      "as_of_date": "2026-09-30",
      "period": "2026-Q3",
      "ami": 63.9,
      "abri": 54.7,
      "ami_weight_covered": 0.4,
      "abri_weight_covered": 0.45,
      "candidate_state": "TRANSITION",
      "formal_ami": null,
      "formal_abri": null
    }
  ],
  "tier2": {
    "observation_count": 0,
    "used": false
  },
  "coverage_universe": {
    "company_count": 13,
    "note_zh": "只涵蓋十三間美國上市大型公司的官方披露數據"
  },
  "disclaimer_zh": "此讀數為暫定參考：只用已有足夠數據的支柱計算，並非正式指數；屬季度滯後指標，不是買賣訊號、價格預測或投資建議。"
} as unknown as AiCycleSignal;
