import { useEffect, useMemo, useState } from 'react';

import { ImportPreviewEditor } from '../import/ImportPreviewEditor';
import { usePortfolioAssets } from '../../hooks/usePortfolioAssets';
import { callPortfolioFunction } from '../../lib/api/vercelFunctions';
import { createAssetTransaction, getAssetTransactionsErrorMessage } from '../../lib/firebase/assetTransactions';
import { createPortfolioAsset, getFirebaseAssetsErrorMessage } from '../../lib/firebase/assets';
import type {
  AccountSource,
  AssetTransactionType,
  AssetType,
  PortfolioAssetInput,
} from '../../types/portfolio';
import type {
  ImportPreviewClassification,
  ImportPreviewItem,
  ParseTransactionsCommandRequest,
  ParseTransactionsCommandResponse,
} from '../../types/extractAssets';

type InputMode = 'ai' | 'manual';

const LOCKED_CASH_ACCOUNT_SOURCES: AccountSource[] = ['IB', 'Futu', 'Crypto'];

function normalizeUppercase(value: string) {
  return value.trim().toUpperCase();
}

function buildHoldingLookupKey(symbol: string, accountSource: AccountSource) {
  return `${symbol.trim().toUpperCase()}::${accountSource}`;
}

function selectDefaultCashAccountSource(
  preferredAccountSource: AccountSource,
  availableCashAccountSources: AccountSource[],
) {
  if (availableCashAccountSources.includes(preferredAccountSource)) {
    return preferredAccountSource;
  }

  return availableCashAccountSources[0] ?? '';
}

function createBlankItem(
  index: number,
  assetAccountSource: AccountSource,
  settlementAccountSource: AccountSource | '',
  classification: ImportPreviewClassification = 'new_asset',
): ImportPreviewItem {
  return {
    id: `manual-${index}-${Date.now()}`,
    name: '',
    ticker: '',
    type: '',
    classification,
    existingAssetId: '',
    assetAccountSource,
    settlementAccountSource,
    transactionType: 'buy',
    quantity: '',
    currency: 'USD',
    price: '',
    fees: '0',
    date: new Date().toISOString().slice(0, 10),
    note: '',
  };
}

function buildPreviewItemFromTransaction(
  itemId: string,
  entry: ParseTransactionsCommandResponse['transactions'][number],
  classification: ImportPreviewClassification,
  assetAccountSource: AccountSource,
  settlementAccountSource: AccountSource | '',
  existingAssetId = '',
) {
  return {
    id: itemId,
    name: entry.name ?? '',
    ticker: entry.ticker ?? '',
    type: entry.type ?? '',
    classification,
    existingAssetId,
    assetAccountSource,
    settlementAccountSource,
    transactionType: entry.transactionType ?? '',
    quantity: entry.quantity == null ? '' : String(entry.quantity),
    currency: entry.currency ?? '',
    price: entry.price == null ? '' : String(entry.price),
    fees: entry.fees == null ? '0' : String(entry.fees),
    date: entry.date ?? new Date().toISOString().slice(0, 10),
    note: entry.note ?? '',
  } satisfies ImportPreviewItem;
}

function getMissingPreviewFields(item: ImportPreviewItem) {
  const missing: string[] = [];

  if (!item.name.trim()) {
    missing.push('名稱');
  }
  if (!item.ticker.trim()) {
    missing.push('Ticker');
  }
  if (!item.type) {
    missing.push('類型');
  }
  if (!item.assetAccountSource) {
    missing.push('資產帳戶');
  }
  if (!item.settlementAccountSource) {
    missing.push('現金帳戶');
  }
  if (item.classification === 'existing_transaction' && !item.existingAssetId) {
    missing.push('對應資產');
  }
  if (!item.transactionType) {
    missing.push('交易類型');
  }
  if (!item.quantity.trim()) {
    missing.push('數量');
  }
  if (!item.currency.trim()) {
    missing.push('幣別');
  }
  if (!item.price.trim()) {
    missing.push('成交價');
  }
  if (!item.date.trim()) {
    missing.push('日期');
  }

  return missing;
}

function assertTransactionType(value: ImportPreviewItem['transactionType']): AssetTransactionType {
  if (value === 'buy' || value === 'sell') {
    return value;
  }

  throw new Error('交易類型未設定，請先揀選買入或賣出。');
}

interface TransactionInputPanelProps {
  onClose: () => void;
}

export function TransactionInputPanel({ onClose }: TransactionInputPanelProps) {
  const { holdings } = usePortfolioAssets();
  const tradeableHoldings = useMemo(
    () => holdings.filter((holding) => holding.assetType !== 'cash'),
    [holdings],
  );
  const holdingsById = useMemo(
    () => new Map(tradeableHoldings.map((holding) => [holding.id, holding])),
    [tradeableHoldings],
  );
  const holdingsByTickerAndSource = useMemo(
    () =>
      new Map(
        tradeableHoldings.map((holding) => [
          buildHoldingLookupKey(holding.symbol, holding.accountSource),
          holding,
        ] as const),
      ),
    [tradeableHoldings],
  );
  const lockedCashHoldings = useMemo(
    () =>
      holdings.filter(
        (holding) =>
          holding.assetType === 'cash' &&
          LOCKED_CASH_ACCOUNT_SOURCES.includes(holding.accountSource),
      ),
    [holdings],
  );
  const availableCashAccountSources = useMemo(
    () => Array.from(new Set(lockedCashHoldings.map((holding) => holding.accountSource))),
    [lockedCashHoldings],
  );
  const defaultAssetAccountSource = useMemo(
    () => tradeableHoldings[0]?.accountSource ?? 'Other',
    [tradeableHoldings],
  );
  const defaultCashAccountSource = useMemo(
    () => selectDefaultCashAccountSource(defaultAssetAccountSource, availableCashAccountSources),
    [availableCashAccountSources, defaultAssetAccountSource],
  );
  const existingAssetOptions = useMemo(
    () =>
      tradeableHoldings.map((holding) => ({
        id: holding.id,
        label: `${holding.symbol} · ${holding.name} · ${holding.accountSource}`,
        accountSource: holding.accountSource,
      })),
    [tradeableHoldings],
  );
  const [inputMode, setInputMode] = useState<InputMode>('ai');
  const [commandText, setCommandText] = useState('');
  const [extractStatus, setExtractStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [extractError, setExtractError] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[]>([]);
  const [confirmStatus, setConfirmStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (inputMode !== 'manual') {
      return;
    }

    setPreviewItems((current) =>
      current.length > 0
        ? current
        : [
            createBlankItem(
              0,
              defaultAssetAccountSource,
              defaultCashAccountSource,
              'new_asset',
            ),
          ],
    );
  }, [inputMode, defaultAssetAccountSource, defaultCashAccountSource]);

  function findMatchedHolding(symbol: string, accountSource: AccountSource) {
    const normalizedSymbol = normalizeUppercase(symbol);

    return (
      holdingsByTickerAndSource.get(buildHoldingLookupKey(normalizedSymbol, accountSource)) ??
      tradeableHoldings.find((holding) => holding.symbol === normalizedSymbol)
    );
  }

  function replaceItems(nextItems: ImportPreviewItem[]) {
    setPreviewItems(nextItems);
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  function handleChangeItem(itemId: string, field: keyof ImportPreviewItem, value: string) {
    setPreviewItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        const nextValue = field === 'ticker' || field === 'currency' ? value.toUpperCase() : value;
        const updated = {
          ...item,
          [field]: nextValue,
        };

        if (field === 'classification' && value === 'new_asset') {
          updated.existingAssetId = '';
        }

        if (field === 'classification' && value === 'existing_transaction') {
          const matchedHolding = findMatchedHolding(
            updated.ticker,
            updated.assetAccountSource || defaultAssetAccountSource,
          );
          if (matchedHolding) {
            updated.existingAssetId = matchedHolding.id;
            updated.assetAccountSource = matchedHolding.accountSource;
          }
        }

        if (field === 'ticker' && item.classification === 'existing_transaction') {
          updated.existingAssetId = '';
        }

        if (field === 'existingAssetId') {
          const selectedHolding = holdingsById.get(value);
          if (selectedHolding) {
            updated.assetAccountSource = selectedHolding.accountSource;
            updated.ticker = selectedHolding.symbol;
            updated.name = item.name || selectedHolding.name;
            updated.type = item.type || selectedHolding.assetType;
          }
        }

        return updated;
      }),
    );
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  function handleAddManualItem() {
    setPreviewItems((current) => [
      ...current,
      createBlankItem(
        current.length,
        defaultAssetAccountSource,
        defaultCashAccountSource,
        'new_asset',
      ),
    ]);
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  function handleRemoveItem(itemId: string) {
    setPreviewItems((current) => current.filter((item) => item.id !== itemId));
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  async function handleParseCommand() {
    if (!commandText.trim()) {
      setExtractStatus('error');
      setExtractError('請先輸入交易內容，再開始解析。');
      return;
    }

    setExtractStatus('loading');
    setExtractError(null);
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);

    try {
      const payload: ParseTransactionsCommandRequest = { text: commandText.trim() };
      const response = (await callPortfolioFunction(
        'parse-transactions-command',
        payload,
      )) as ParseTransactionsCommandResponse;

      const items = response.transactions.map((entry, index) => {
        const matchedHolding =
          entry.ticker == null ? undefined : findMatchedHolding(entry.ticker, defaultAssetAccountSource);

        return buildPreviewItemFromTransaction(
          `preview-transaction-${index}-${entry.ticker ?? 'item'}`,
          entry,
          matchedHolding ? 'existing_transaction' : 'new_asset',
          matchedHolding?.accountSource ?? defaultAssetAccountSource,
          defaultCashAccountSource,
          matchedHolding?.id ?? '',
        );
      });

      replaceItems(items);
      setExtractStatus('success');
    } catch (error) {
      setExtractStatus('error');
      setExtractError(error instanceof Error ? error.message : '解析交易內容失敗，請稍後再試。');
    }
  }

  async function createAssetAndTrade(item: ImportPreviewItem) {
    if (item.transactionType !== 'buy') {
      throw new Error('新增資產只支援買入交易；如果係現有持倉買賣，請改揀「現有資產交易」。');
    }

    if (item.type === 'cash') {
      throw new Error('唔可以新增現金資產，請改用既有 IB、富途或穩定幣現金資產。');
    }

    const assetPayload: PortfolioAssetInput = {
      name: item.name.trim(),
      symbol: normalizeUppercase(item.ticker),
      assetType: item.type as Exclude<AssetType, 'cash'>,
      accountSource: item.assetAccountSource as AccountSource,
      currency: normalizeUppercase(item.currency),
      quantity: 0,
      averageCost: 0,
      currentPrice: 0,
    };
    const assetId = await createPortfolioAsset(assetPayload);
    const transactionType = assertTransactionType(item.transactionType);

    await createAssetTransaction({
      assetId,
      assetName: assetPayload.name,
      symbol: assetPayload.symbol,
      assetType: assetPayload.assetType,
      accountSource: assetPayload.accountSource,
      settlementAccountSource: item.settlementAccountSource as AccountSource,
      transactionType,
      quantity: Number(item.quantity),
      price: Number(item.price),
      fees: Number(item.fees) || 0,
      currency: assetPayload.currency,
      date: item.date,
      note: item.note.trim() || undefined,
    });
  }

  async function handleConfirm() {
    const invalidItem = previewItems.find((item) => getMissingPreviewFields(item).length > 0);

    if (invalidItem) {
      setConfirmStatus('error');
      setConfirmError('仍有缺少欄位，請先補齊再確認匯入。');
      return;
    }

    if (previewItems.length === 0) {
      setConfirmStatus('error');
      setConfirmError('未有可儲存的交易預覽。');
      return;
    }

    if (availableCashAccountSources.length === 0) {
      setConfirmStatus('error');
      setConfirmError('未找到既有的 IB、富途或穩定幣現金資產，暫時無法匯入交易。');
      return;
    }

    setConfirmStatus('loading');
    setConfirmError(null);
    setConfirmSuccess(null);

    try {
      let createdAssetCount = 0;
      let createdTransactionCount = 0;

      for (const item of previewItems) {
        if (item.classification === 'new_asset') {
          await createAssetAndTrade(item);
          createdAssetCount += 1;
          createdTransactionCount += 1;
          continue;
        }

        const matchedHolding = holdingsById.get(item.existingAssetId);
        if (!matchedHolding) {
          throw new Error(`${item.ticker} 未揀選對應現有資產。`);
        }

        const transactionType = assertTransactionType(item.transactionType);

        await createAssetTransaction({
          assetId: matchedHolding.id,
          assetName: matchedHolding.name,
          symbol: matchedHolding.symbol,
          assetType: matchedHolding.assetType,
          accountSource: matchedHolding.accountSource,
          settlementAccountSource: item.settlementAccountSource as AccountSource,
          transactionType,
          quantity: Number(item.quantity),
          price: Number(item.price),
          fees: Number(item.fees) || 0,
          currency: normalizeUppercase(item.currency),
          date: item.date,
          note: item.note.trim() || undefined,
        });
        createdTransactionCount += 1;
      }

      setConfirmStatus('success');
      setConfirmSuccess(
        createdAssetCount > 0
          ? `已新增 ${createdAssetCount} 項資產，並寫入 ${createdTransactionCount} 筆交易記錄。`
          : `已寫入 ${createdTransactionCount} 筆交易記錄。`,
      );
    } catch (error) {
      setConfirmStatus('error');
      const message =
        error instanceof Error
          ? error.message
          : previewItems.some((item) => item.classification === 'new_asset')
            ? getFirebaseAssetsErrorMessage(error)
            : getAssetTransactionsErrorMessage(error);
      setConfirmError(message);
    }
  }

  const hasPreviewItems = previewItems.length > 0;

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">輸入</p>
          <h2>輸入交易</h2>
          <p className="table-hint">
            你可以用 AI 文字輸入快速整理交易，或者直接手動填入每筆交易，再選新增資產交易或現有資產交易。
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={onClose}>
          關閉
        </button>
      </div>

      <div className="import-mode-row" role="tablist" aria-label="選擇輸入方式">
        <button
          className={inputMode === 'ai' ? 'filter-chip active' : 'filter-chip'}
          type="button"
          onClick={() => setInputMode('ai')}
        >
          AI 文字輸入
        </button>
        <button
          className={inputMode === 'manual' ? 'filter-chip active' : 'filter-chip'}
          type="button"
          onClick={() => setInputMode('manual')}
        >
          手動輸入
        </button>
      </div>

      {inputMode === 'ai' ? (
        <div className="prompt-box import-command-box">
          <strong>貼入交易描述，AI 自動拆分</strong>
          <p className="table-hint">
            例如：今日買入 TSLA 5 股，240 美元，手續費 1.5；再新增 SOL 10 粒，成本 132 美元。
          </p>
          <textarea
            value={commandText}
            onChange={(event) => setCommandText(event.target.value)}
            placeholder="輸入內容後，AI 會逐筆拆開，再由你揀每筆係新增資產交易定現有資產交易。"
          />
          <div className="button-row">
            <button className="button button-primary" type="button" onClick={handleParseCommand}>
              {extractStatus === 'loading' ? '解析中...' : '開始解析'}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setCommandText('');
                setPreviewItems([]);
                setExtractStatus('idle');
                setExtractError(null);
              }}
            >
              清除
            </button>
          </div>
        </div>
      ) : (
        <div className="prompt-box import-command-box">
          <strong>手動輸入每筆交易，之後再選「新增資產交易」或者「現有資產交易」</strong>
          <p className="table-hint">
            儲存後會自動對應現金帳戶，並按交易方向加減 IB、富途或穩定幣現金資產。
          </p>
          <div className="button-row">
            <button className="button button-secondary" type="button" onClick={handleAddManualItem}>
              新增一筆交易
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setPreviewItems([createBlankItem(0, defaultAssetAccountSource, defaultCashAccountSource)])}
            >
              重設
            </button>
          </div>
        </div>
      )}

      {extractError ? <p className="status-message status-message-error">{extractError}</p> : null}
      {confirmError ? <p className="status-message status-message-error">{confirmError}</p> : null}
      {confirmSuccess ? <p className="status-message status-message-success">{confirmSuccess}</p> : null}

      {hasPreviewItems ? (
        <ImportPreviewEditor
          items={previewItems}
          existingAssetOptions={existingAssetOptions}
          cashAccountSources={availableCashAccountSources}
          onChangeItem={handleChangeItem}
          onRemoveItem={handleRemoveItem}
          onConfirm={handleConfirm}
          isConfirming={confirmStatus === 'loading'}
          confirmError={confirmError}
          confirmSuccess={confirmSuccess}
        />
      ) : (
        <p className="status-message">
          {inputMode === 'ai'
            ? '未有 AI 解析結果。'
            : '未有交易草稿，請先新增一筆交易。'}
        </p>
      )}
    </section>
  );
}
