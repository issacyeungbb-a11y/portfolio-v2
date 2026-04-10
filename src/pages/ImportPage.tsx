import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import { ImportPreviewEditor } from '../components/import/ImportPreviewEditor';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import { createAssetTransaction, getAssetTransactionsErrorMessage } from '../lib/firebase/assetTransactions';
import { createPortfolioAsset, getFirebaseAssetsErrorMessage } from '../lib/firebase/assets';
import type {
  AccountSource,
  AssetTransactionType,
  AssetType,
  PortfolioAssetInput,
} from '../types/portfolio';
import type {
  ExtractAssetsRequest,
  ExtractAssetsResponse,
  ExtractTransactionsRequest,
  ExtractTransactionsResponse,
  ImportPreviewClassification,
  ImportPreviewItem,
  ParseAssetsCommandRequest,
  ParseAssetsCommandResponse,
  ParseTransactionsCommandRequest,
  ParseTransactionsCommandResponse,
} from '../types/extractAssets';

type ExtractStatus = 'idle' | 'loading' | 'success' | 'error';
type ImportInputMode = 'image' | 'text';

interface ParsedImportResult {
  assetModel: string;
  transactionModel: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: {
    readonly transcript: string;
  };
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

const MAX_UPLOAD_DIMENSION = 1600;
const MAX_UPLOAD_BYTES = 3_200_000;
const COMPRESSED_MIME_TYPE = 'image/jpeg';
const COMPRESSED_QUALITY = 0.82;
const LOCKED_CASH_ACCOUNT_SOURCES: AccountSource[] = ['IB', 'Futu', 'Crypto'];

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('無法讀取圖片資料，請重新上傳。'));
    };

    reader.onerror = () => {
      reject(new Error('讀取圖片失敗，請重新上傳。'));
    };

    reader.readAsDataURL(file);
  });
}

function getBase64FromDataUrl(dataUrl: string) {
  const [, base64 = ''] = dataUrl.split(',');
  return base64;
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('無法讀取截圖內容，請換另一張圖片再試。'));
    image.src = dataUrl;
  });
}

async function compressScreenshot(file: File) {
  const originalDataUrl = await readFileAsDataUrl(file);

  if (!file.type.startsWith('image/')) {
    return {
      dataUrl: originalDataUrl,
      mimeType: file.type || 'image/png',
    };
  }

  const image = await loadImage(originalDataUrl);
  const scale = Math.min(1, MAX_UPLOAD_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return {
      dataUrl: originalDataUrl,
      mimeType: file.type || 'image/png',
    };
  }

  context.drawImage(image, 0, 0, width, height);

  let quality = COMPRESSED_QUALITY;
  let compressedDataUrl = canvas.toDataURL(COMPRESSED_MIME_TYPE, quality);

  while (compressedDataUrl.length > MAX_UPLOAD_BYTES && quality > 0.5) {
    quality -= 0.08;
    compressedDataUrl = canvas.toDataURL(COMPRESSED_MIME_TYPE, quality);
  }

  return {
    dataUrl: compressedDataUrl,
    mimeType: COMPRESSED_MIME_TYPE,
  };
}

function inferAccountSource(fileName: string): AccountSource {
  const normalized = fileName.toLowerCase();

  if (normalized.includes('futu')) {
    return 'Futu';
  }

  if (normalized.includes('ib')) {
    return 'IB';
  }

  if (normalized.includes('crypto') || normalized.includes('wallet')) {
    return 'Crypto';
  }

  return 'Other';
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

function normalizeUppercase(value: string) {
  return value.trim().toUpperCase();
}

function buildPreviewItemFromTransaction(
  itemId: string,
  entry: ExtractTransactionsResponse['transactions'][number],
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

function buildPreviewItemFromAsset(
  itemId: string,
  entry: ExtractAssetsResponse['assets'][number],
  assetAccountSource: AccountSource,
  settlementAccountSource: AccountSource | '',
) {
  return {
    id: itemId,
    name: entry.name ?? '',
    ticker: entry.ticker ?? '',
    type: entry.type ?? '',
    classification: 'new_asset',
    existingAssetId: '',
    assetAccountSource,
    settlementAccountSource,
    transactionType: 'buy',
    quantity: entry.quantity == null ? '' : String(entry.quantity),
    currency: entry.currency ?? '',
    price:
      entry.costBasis == null
        ? entry.currentPrice == null
          ? ''
          : String(entry.currentPrice)
        : String(entry.costBasis),
    fees: '0',
    date: new Date().toISOString().slice(0, 10),
    note: '',
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

export function ImportPage() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const { holdings } = usePortfolioAssets();
  const [inputMode, setInputMode] = useState<ImportInputMode>('image');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [uploadMimeType, setUploadMimeType] = useState<string>('image/png');
  const [commandText, setCommandText] = useState('');
  const [defaultAccountSource, setDefaultAccountSource] = useState<AccountSource>('Other');
  const [extractStatus, setExtractStatus] = useState<ExtractStatus>('idle');
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<ParsedImportResult | null>(null);
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[]>([]);
  const [confirmStatus, setConfirmStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

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
  const existingAssetOptions = useMemo(
    () =>
      tradeableHoldings.map((holding) => ({
        id: holding.id,
        label: `${holding.symbol} · ${holding.name} · ${holding.accountSource}`,
        accountSource: holding.accountSource,
      })),
    [tradeableHoldings],
  );

  const canUseSpeechInput =
    typeof window !== 'undefined' &&
    Boolean((window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructorLike;
      webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
    }).SpeechRecognition ||
      (window as Window & {
        SpeechRecognition?: SpeechRecognitionConstructorLike;
        webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
      }).webkitSpeechRecognition);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      recognitionRef.current?.stop();
    };
  }, [previewUrl]);

  function resetParseState() {
    setExtractStatus('idle');
    setExtractError(null);
    setExtractResult(null);
    setPreviewItems([]);
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  function findMatchedHolding(symbol: string, accountSource: AccountSource) {
    const normalizedSymbol = normalizeUppercase(symbol);

    return (
      holdingsByTickerAndSource.get(buildHoldingLookupKey(normalizedSymbol, accountSource)) ??
      tradeableHoldings.find((holding) => holding.symbol === normalizedSymbol)
    );
  }

  function applyParsedImportResults(
    assetsResponse: ExtractAssetsResponse | ParseAssetsCommandResponse,
    transactionsResponse: ExtractTransactionsResponse | ParseTransactionsCommandResponse,
  ) {
    const defaultCashAccountSource = selectDefaultCashAccountSource(
      defaultAccountSource,
      availableCashAccountSources,
    );

    const items =
      transactionsResponse.transactions.length > 0
        ? transactionsResponse.transactions.map((entry, index) => {
            const matchedHolding =
              entry.ticker == null ? undefined : findMatchedHolding(entry.ticker, defaultAccountSource);
            return buildPreviewItemFromTransaction(
              `preview-transaction-${index}-${entry.ticker ?? 'item'}`,
              entry,
              matchedHolding ? 'existing_transaction' : 'new_asset',
              matchedHolding?.accountSource ?? defaultAccountSource,
              defaultCashAccountSource,
              matchedHolding?.id ?? '',
            );
          })
        : assetsResponse.assets.map((entry, index) =>
            buildPreviewItemFromAsset(
              `preview-asset-${index}-${entry.ticker ?? 'item'}`,
              entry,
              defaultAccountSource,
              defaultCashAccountSource,
            ),
          );

    setExtractResult({
      assetModel: assetsResponse.model,
      transactionModel: transactionsResponse.model,
    });
    setPreviewItems(items);
    setExtractStatus('success');
  }

  function handleChangeInputMode(mode: ImportInputMode) {
    setInputMode(mode);
    setSpeechError(null);
    setIsListening(false);
    recognitionRef.current?.stop();
    resetParseState();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const compressedImage = await compressScreenshot(file);
      const nextPreviewUrl = URL.createObjectURL(file);

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      setSelectedFile(file);
      setPreviewUrl(nextPreviewUrl);
      setImageBase64(getBase64FromDataUrl(compressedImage.dataUrl));
      setUploadMimeType(compressedImage.mimeType);
      setDefaultAccountSource(inferAccountSource(file.name));
      resetParseState();
    } catch (error) {
      setExtractStatus('error');
      setExtractError(error instanceof Error ? error.message : '讀取圖片失敗，請重新上傳。');
    }
  }

  function handleChangePreviewItem(
    itemId: string,
    field: keyof ImportPreviewItem,
    value: string,
  ) {
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
            updated.assetAccountSource || defaultAccountSource,
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

  function handleRemovePreviewItem(itemId: string) {
    setPreviewItems((current) => current.filter((item) => item.id !== itemId));
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  async function handleExtract() {
    if (!selectedFile || !imageBase64) {
      setExtractStatus('error');
      setExtractError('請先上傳一張截圖，再開始解析。');
      return;
    }

    setExtractStatus('loading');
    setExtractError(null);
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);

    try {
      const payload: ExtractAssetsRequest & ExtractTransactionsRequest = {
        fileName: selectedFile.name,
        mimeType: uploadMimeType,
        imageBase64,
      };
      const [assetsResponse, transactionsResponse] = await Promise.all([
        callPortfolioFunction('extract-assets', payload) as Promise<ExtractAssetsResponse>,
        callPortfolioFunction('extract-transactions', payload) as Promise<ExtractTransactionsResponse>,
      ]);
      applyParsedImportResults(assetsResponse, transactionsResponse);
    } catch (error) {
      setExtractStatus('error');
      setExtractError(error instanceof Error ? error.message : '解析截圖失敗，請稍後再試。');
    }
  }

  async function handleParseCommand() {
    if (!commandText.trim()) {
      setExtractStatus('error');
      setExtractError('請先輸入文字或語音內容，再開始解析。');
      return;
    }

    setExtractStatus('loading');
    setExtractError(null);
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);

    try {
      const payload: ParseAssetsCommandRequest & ParseTransactionsCommandRequest = {
        text: commandText.trim(),
      };
      const [assetsResponse, transactionsResponse] = await Promise.all([
        callPortfolioFunction('parse-assets-command', payload) as Promise<ParseAssetsCommandResponse>,
        callPortfolioFunction('parse-transactions-command', payload) as Promise<ParseTransactionsCommandResponse>,
      ]);
      applyParsedImportResults(assetsResponse, transactionsResponse);
    } catch (error) {
      setExtractStatus('error');
      setExtractError(error instanceof Error ? error.message : '解析文字內容失敗，請稍後再試。');
    }
  }

  function handleStartListening() {
    if (!canUseSpeechInput) {
      setSpeechError('目前瀏覽器唔支援語音輸入，請改用文字輸入。');
      return;
    }

    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructorLike;
      webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!Recognition) {
      setSpeechError('目前瀏覽器唔支援語音輸入，請改用文字輸入。');
      return;
    }

    setSpeechError(null);

    if (!recognitionRef.current) {
      const recognition = new Recognition();
      recognition.lang = 'zh-HK';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        let transcript = '';

        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index][0].transcript;
        }

        setCommandText(transcript.trim());
      };

      recognition.onerror = () => {
        setSpeechError('語音輸入失敗，請再試一次或直接改用文字輸入。');
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    setIsListening(true);
    recognitionRef.current.start();
  }

  function handleStopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  async function createAssetAndTrade(item: ImportPreviewItem) {
    if (item.transactionType !== 'buy') {
      throw new Error('新增資產只支援買入交易；如果係現有持倉買賣，請改揀「原有資產交易」。');
    }

    if (item.type === 'cash') {
      throw new Error('匯入頁唔會新增現金資產，請使用既有 IB、富途或穩定幣現金資產。');
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

  async function handleConfirmImport() {
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
        `已新增 ${createdAssetCount} 項資產，並寫入 ${createdTransactionCount} 筆交易記錄。`,
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

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="import-mode-row" role="tablist" aria-label="選擇匯入方式">
          <button
            className={inputMode === 'image' ? 'filter-chip active' : 'filter-chip'}
            type="button"
            onClick={() => handleChangeInputMode('image')}
          >
            圖片分析
          </button>
          <button
            className={inputMode === 'text' ? 'filter-chip active' : 'filter-chip'}
            type="button"
            onClick={() => handleChangeInputMode('text')}
          >
            文字 / 語音輸入
          </button>
        </div>

        <div className="upload-dropzone">
          {extractResult ? (
            <span className="chip chip-strong">
              資產 {extractResult.assetModel} / 交易 {extractResult.transactionModel}
            </span>
          ) : (
            <span className="chip chip-soft">模型 gemini-2.5-flash-lite / gemini-2.5-flash-lite</span>
          )}

          {inputMode === 'image' ? (
            <>
              <strong>上傳截圖，AI 會逐筆識別交易，再由你決定係新增資產定原有資產交易</strong>
              <label className="button button-secondary upload-button">
                選擇圖片
                <input
                  className="visually-hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                />
              </label>
              <button
                className="button button-primary"
                type="button"
                onClick={handleExtract}
                disabled={extractStatus === 'loading' || !selectedFile}
              >
                {extractStatus === 'loading' ? '解析中...' : '開始解析'}
              </button>
            </>
          ) : (
            <div className="prompt-box import-command-box">
              <strong>輸入文字或語音，AI 會先整理成逐筆交易預覽</strong>
              <p className="table-hint">
                例如：今日買入 TSLA 5 股，240 美元，手續費 1.5；再新增 SOL 10 粒，成本 132 美元。
              </p>
              <textarea
                value={commandText}
                onChange={(event) => {
                  setCommandText(event.target.value);
                  resetParseState();
                }}
                placeholder="輸入內容後，AI 會逐筆拆開，再由你揀每筆係新增資產定原有資產交易。"
              />
              <div className="button-row">
                <button className="button button-secondary" type="button" onClick={isListening ? handleStopListening : handleStartListening}>
                  {isListening ? '停止語音輸入' : '語音輸入'}
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleParseCommand}
                  disabled={extractStatus === 'loading' || !commandText.trim()}
                >
                  {extractStatus === 'loading' ? '解析中...' : '開始解析'}
                </button>
              </div>
              {speechError ? <p className="status-message status-message-error">{speechError}</p> : null}
            </div>
          )}
        </div>
      </section>

      {extractError ? <p className="status-message status-message-error">{extractError}</p> : null}

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Preview</p>
            <h2>{inputMode === 'image' ? '截圖預覽' : '文字內容預覽'}</h2>
          </div>
          <span className="chip chip-soft">
            {extractResult
              ? `資產 ${extractResult.assetModel} / 交易 ${extractResult.transactionModel}`
              : inputMode === 'image'
                ? selectedFile
                  ? '已選擇圖片'
                  : '未選擇圖片'
                : commandText.trim()
                  ? '已輸入文字'
                  : '未輸入內容'}
          </span>
        </div>

        {inputMode === 'image' && previewUrl ? (
          <img className="upload-preview-image" src={previewUrl} alt="Uploaded screenshot" />
        ) : null}
        {inputMode === 'image' && !previewUrl ? <p className="status-message">未選擇圖片。</p> : null}
        {inputMode === 'text' ? (
          commandText.trim() ? (
            <div className="extract-meta-note">
              <strong>語音 / 文字內容</strong>
              <p>{commandText}</p>
            </div>
          ) : (
            <p className="status-message">未輸入文字或語音內容。</p>
          )
        ) : null}
      </section>

      {extractStatus === 'success' ? (
        <ImportPreviewEditor
          items={previewItems}
          existingAssetOptions={existingAssetOptions}
          cashAccountSources={availableCashAccountSources}
          onChangeItem={handleChangePreviewItem}
          onRemoveItem={handleRemovePreviewItem}
          onConfirm={handleConfirmImport}
          isConfirming={confirmStatus === 'loading'}
          confirmError={confirmError}
          confirmSuccess={confirmSuccess}
        />
      ) : null}
    </div>
  );
}
