import { useEffect, useState, type ChangeEvent } from 'react';

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
} from '../types/extractAssets';

type ExtractStatus = 'idle' | 'loading' | 'success' | 'error';

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [uploadMimeType, setUploadMimeType] = useState<string>('image/png');
  const [accountSource, setAccountSource] = useState<AccountSource>('Other');
  const [extractStatus, setExtractStatus] = useState<ExtractStatus>('idle');
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractResponse, setExtractResponse] = useState<ExtractAssetsResponse | null>(null);
  const [editableAssets, setEditableAssets] = useState<EditableExtractedAsset[]>([]);
  const [confirmStatus, setConfirmStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

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
      setExtractStatus('idle');
      setExtractError(null);
      setExtractResponse(null);
      setEditableAssets([]);
      setConfirmStatus('idle');
      setConfirmError(null);
      setConfirmSuccess(null);
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
      const nextAssets = response.assets.map((asset, index) =>
        createEditableExtractedAsset(asset, index),
      );

      setExtractResponse(response);
      setEditableAssets(nextAssets);
      setExtractStatus('success');
    } catch (error) {
      setExtractStatus('error');
      setExtractError(
        error instanceof Error ? error.message : '解析截圖失敗，請稍後再試。',
      );
    }
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
        <div>
          <p className="eyebrow">Screenshot Import</p>
          <h2>截圖轉資產資料</h2>
        </div>
        <div className="upload-dropzone">
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
        </div>
      </section>

      {extractError ? <p className="status-message status-message-error">{extractError}</p> : null}

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Preview</p>
            <h2>截圖預覽</h2>
          </div>
          <span className="chip chip-soft">
            {extractResponse ? `模型 ${extractResponse.model}` : selectedFile ? '已選擇圖片' : '未選擇圖片'}
          </span>
        </div>

        {previewUrl ? (
          <img className="upload-preview-image" src={previewUrl} alt="Uploaded portfolio screenshot" />
        ) : (
          <p className="status-message">未選擇圖片。</p>
        )}
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
