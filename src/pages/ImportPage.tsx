import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { ExtractedAssetsEditor } from '../components/import/ExtractedAssetsEditor';
import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import { createPortfolioAssets, getFirebaseAssetsErrorMessage } from '../lib/firebase/assets';
import type { AccountSource } from '../types/portfolio';
import {
  buildPortfolioAssetInputFromExtractedAsset,
  createEditableExtractedAsset,
  getMissingExtractedAssetFields,
  type EditableExtractedAsset,
  type ExtractAssetsRequest,
  type ExtractAssetsResponse,
  type ParseAssetsCommandRequest,
  type ParseAssetsCommandResponse,
} from '../types/extractAssets';

type ExtractStatus = 'idle' | 'loading' | 'success' | 'error';
type ImportInputMode = 'image' | 'text';
type AssetParseResponse = ExtractAssetsResponse | ParseAssetsCommandResponse;

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

export function ImportPage() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [inputMode, setInputMode] = useState<ImportInputMode>('image');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [uploadMimeType, setUploadMimeType] = useState<string>('image/png');
  const [commandText, setCommandText] = useState('');
  const [accountSource, setAccountSource] = useState<AccountSource>('Other');
  const [extractStatus, setExtractStatus] = useState<ExtractStatus>('idle');
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractResponse, setExtractResponse] = useState<AssetParseResponse | null>(null);
  const [editableAssets, setEditableAssets] = useState<EditableExtractedAsset[]>([]);
  const [confirmStatus, setConfirmStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

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
    setExtractResponse(null);
    setEditableAssets([]);
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  function applyParsedAssets(response: AssetParseResponse) {
    const nextAssets = response.assets.map((asset, index) =>
      createEditableExtractedAsset(asset, index),
    );

    setExtractResponse(response);
    setEditableAssets(nextAssets);
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
      setAccountSource(inferAccountSource(file.name));
      resetParseState();
    } catch (error) {
      setExtractStatus('error');
      setExtractError(
        error instanceof Error ? error.message : '讀取圖片失敗，請重新上傳。',
      );
    }
  }

  function handleAssetChange(
    assetId: string,
    field: keyof EditableExtractedAsset,
    value: string,
  ) {
    setEditableAssets((current) =>
      current.map((asset) =>
        asset.id === assetId
          ? {
              ...asset,
              [field]:
                field === 'ticker' || field === 'currency'
                  ? value.toUpperCase()
                  : value,
            }
          : asset,
      ),
    );
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  function handleRemoveAsset(assetId: string) {
    setEditableAssets((current) => current.filter((asset) => asset.id !== assetId));
    setConfirmStatus('idle');
    setConfirmError(null);
    setConfirmSuccess(null);
  }

  async function handleExtractAssets() {
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
      const payload: ExtractAssetsRequest = {
        fileName: selectedFile.name,
        mimeType: uploadMimeType,
        imageBase64,
      };
      const response = (await callPortfolioFunction(
        'extract-assets',
        payload,
      )) as ExtractAssetsResponse;
      applyParsedAssets(response);
    } catch (error) {
      setExtractStatus('error');
      setExtractError(
        error instanceof Error ? error.message : '解析截圖失敗，請稍後再試。',
      );
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
      const payload: ParseAssetsCommandRequest = {
        text: commandText.trim(),
      };
      const response = (await callPortfolioFunction(
        'parse-assets-command',
        payload,
      )) as ParseAssetsCommandResponse;
      applyParsedAssets(response);
    } catch (error) {
      setExtractStatus('error');
      setExtractError(
        error instanceof Error ? error.message : '解析文字內容失敗，請稍後再試。',
      );
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
    const Recognition =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

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

  async function handleConfirmImport() {
    const hasMissingFields = editableAssets.some(
      (asset) => getMissingExtractedAssetFields(asset).length > 0,
    );

    if (hasMissingFields) {
      setConfirmStatus('error');
      setConfirmError('仍有缺少欄位，請先補齊再確認匯入。');
      return;
    }

    setConfirmStatus('loading');
    setConfirmError(null);
    setConfirmSuccess(null);

    try {
      const payloads = editableAssets.map((asset) =>
        buildPortfolioAssetInputFromExtractedAsset(asset, accountSource),
      );

      await createPortfolioAssets(payloads);

      setConfirmStatus('success');
      setConfirmSuccess(`已成功寫入 Firestore，共 ${payloads.length} 項資產。`);
    } catch (error) {
      setConfirmStatus('error');
      setConfirmError(getFirebaseAssetsErrorMessage(error));
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
          {extractResponse ? (
            <span className="chip chip-strong">模型 {extractResponse.model}</span>
          ) : (
            <span className="chip chip-soft">模型 gemini-2.5-flash-lite</span>
          )}

          {inputMode === 'image' ? (
            <>
              <strong>上傳單張截圖</strong>
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
                onClick={handleExtractAssets}
                disabled={extractStatus === 'loading' || !selectedFile}
              >
                {extractStatus === 'loading' ? '解析中...' : '開始解析'}
              </button>
              {selectedFile ? (
                <div className="upload-file-meta">
                  <strong>{selectedFile.name}</strong>
                  <p>
                    {selectedFile.type || 'image/*'}
                    {uploadMimeType !== (selectedFile.type || 'image/png')
                      ? ` -> ${uploadMimeType}`
                      : ''}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="prompt-box import-command-box">
              <strong>描述你要加入或整理的資產</strong>
              <p className="table-hint">
                例如：加入 TSLA 10 股，美元，平均成本 225.3；再加入 2800.HK 200 股，成本 18.9 港元。
              </p>
              <textarea
                value={commandText}
                onChange={(event) => {
                  setCommandText(event.target.value);
                  resetParseState();
                }}
                placeholder="輸入文字，或者先按語音輸入再讓 AI 整理成資產草稿。"
              />
              <div className="button-row">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={isListening ? handleStopListening : handleStartListening}
                >
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
            {extractResponse
              ? `模型 ${extractResponse.model}`
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
          <img className="upload-preview-image" src={previewUrl} alt="Uploaded portfolio screenshot" />
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
        <ExtractedAssetsEditor
          assets={editableAssets}
          accountSource={accountSource}
          onChangeAsset={handleAssetChange}
          onRemoveAsset={handleRemoveAsset}
          onChangeAccountSource={setAccountSource}
          onConfirm={handleConfirmImport}
          isConfirming={confirmStatus === 'loading'}
          confirmError={confirmError}
          confirmSuccess={confirmSuccess}
        />
      ) : null}

    </div>
  );
}
