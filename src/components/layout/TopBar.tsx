interface TopBarProps {
  title: string;
  subtitle: string;
}

export function TopBar({ title, subtitle }: TopBarProps) {
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">Portfolio V2</p>
        <h1>{title}</h1>
        <p className="top-bar-subtitle">{subtitle}</p>
      </div>
      <div className="top-bar-meta">
        <span className="chip chip-soft">Mock Data</span>
        <span className="chip chip-strong">Mobile First</span>
      </div>
    </header>
  );
}
