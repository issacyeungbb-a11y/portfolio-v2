import { FunctionTestCard } from '../components/dev/FunctionTestCard';
import { usePortfolioAccess } from '../hooks/usePortfolioAccess';

export function SettingsPage() {
  const { status, lock } = usePortfolioAccess();

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>共享模式與偏好設定</h2>
          <p className="hero-copy">
            這裡會整理共享存取碼模式、資料同步方式與價格更新偏好，讓你在不同裝置都能用同一份投資組合資料。
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
              <h2>共享存取</h2>
            </div>
          </div>

          <div className="settings-list">
            <div className="setting-row">
              <div>
                <strong>目前模式</strong>
                <p>改為共享投資組合模式，不再使用匿名 Firebase Auth。</p>
              </div>
              <span className="chip chip-soft">
                {status === 'unlocked' ? 'Access Code' : status}
              </span>
            </div>
            <div className="setting-row">
              <div>
                <strong>共享資料路徑</strong>
                <p className="mono-value">portfolio/app</p>
              </div>
              <span className="chip chip-strong">Shared</span>
            </div>
          </div>

          <div className="roadmap-list">
            <div className="roadmap-item">
              <strong>共享模式</strong>
              <p>所有已輸入存取碼的裝置都會讀寫同一份 `portfolio/app` Firestore 資料。</p>
            </div>
          </div>

          <div className="roadmap-list">
            <div className="roadmap-item">
              <strong>免正式登入</strong>
              <p>每部新裝置只需輸入一次共享存取碼，之後通常可直接進入系統。</p>
            </div>
            <div className="roadmap-item">
              <strong>跨裝置同步</strong>
              <p>手機、平板、電腦會共用同一套共享投資組合資料。</p>
            </div>
            <div className="roadmap-item">
              <strong>重新鎖定裝置</strong>
              <p>如需在本機重新輸入存取碼，可以手動清除已驗證狀態。</p>
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
          <button className="button button-secondary" type="button" onClick={lock}>
            重新鎖定此裝置
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
