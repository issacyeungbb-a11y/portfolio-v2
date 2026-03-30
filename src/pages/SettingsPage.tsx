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
              </div>
              <span className="chip chip-soft">HKD</span>
            </div>
            <div className="setting-row">
              <div>
                <strong>價格更新模式</strong>
              </div>
              <span className="chip chip-soft">Manual</span>
            </div>
            <div className="setting-row">
              <div>
                <strong>AI 分析語言</strong>
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
        description=""
        functionKey="health"
        buttonLabel="測試 /api/health"
      />
    </div>
  );
}
