import { FunctionTestCard } from '../components/dev/FunctionTestCard';
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';

export function SettingsPage() {
  const { uid, isAnonymous, status } = useAnonymousAuth();

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>匿名身份與偏好設定</h2>
          <p className="hero-copy">
            這裡先把未來的基準貨幣、資料保留、價格更新偏好與匿名身份說明整理成清楚的卡片式介面。
          </p>
        </div>
      </section>

      <section className="content-grid">
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Preferences</p>
              <h2>投資組合偏好</h2>
            </div>
          </div>

          <div className="settings-list">
            <div className="setting-row">
              <div>
                <strong>基準貨幣</strong>
                <p>目前以 HKD 顯示總覽。</p>
              </div>
              <span className="chip chip-soft">HKD</span>
            </div>
            <div className="setting-row">
              <div>
                <strong>價格更新模式</strong>
                <p>先用手動更新，之後再加每日同步。</p>
              </div>
              <span className="chip chip-soft">Manual</span>
            </div>
            <div className="setting-row">
              <div>
                <strong>AI 分析語言</strong>
                <p>目前介面示意為繁體中文。</p>
              </div>
              <span className="chip chip-soft">繁中</span>
            </div>
          </div>
        </article>

        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Identity</p>
              <h2>匿名身份</h2>
            </div>
          </div>

          <div className="settings-list">
            <div className="setting-row">
              <div>
                <strong>目前身份</strong>
                <p>應用程式開啟時自動匿名登入，不需要正式登入頁。</p>
              </div>
              <span className="chip chip-soft">
                {isAnonymous ? 'Anonymous' : status}
              </span>
            </div>
            <div className="setting-row">
              <div>
                <strong>匿名 UID</strong>
                <p className="mono-value">{uid ?? '尚未取得 UID'}</p>
              </div>
              <span className="chip chip-strong">users/{'{uid}'}</span>
            </div>
          </div>

          <div className="roadmap-list">
            <div className="roadmap-item">
              <strong>Firestore 初始化</strong>
              <p>登入成功後會自動建立或更新 `users/{'{uid}'}` 文件。</p>
            </div>
          </div>

          <div className="roadmap-list">
            <div className="roadmap-item">
              <strong>免正式登入</strong>
              <p>正式版會用 Firebase Anonymous Auth 建立輕量身份。</p>
            </div>
            <div className="roadmap-item">
              <strong>資料與裝置綁定</strong>
              <p>若清除瀏覽器資料或換裝置，匿名帳號可能無法直接找回。</p>
            </div>
            <div className="roadmap-item">
              <strong>未來可升級帳號</strong>
              <p>等 MVP 穩定後，再考慮把匿名身份升級為正式登入。</p>
            </div>
          </div>
        </article>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Data Safety</p>
            <h2>資料操作</h2>
          </div>
        </div>

        <div className="button-row">
          <button className="button button-secondary" type="button">
            匯出資產資料
          </button>
          <button className="button button-secondary" type="button">
            清除本機假資料
          </button>
        </div>
      </section>

      <FunctionTestCard
        title="Health Function 測試"
        description="呢張卡會測試 `/api/health`，確認前端已經可以打到 Vercel Functions 骨架。"
        functionKey="health"
        buttonLabel="測試 /api/health"
      />
    </div>
  );
}
