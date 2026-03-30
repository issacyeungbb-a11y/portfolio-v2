interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">Portfolio V2</p>
        <h1>{title}</h1>
      </div>
      <div className="top-bar-meta">
        <span className="chip chip-strong">Shared</span>
      </div>
    </header>
  );
}
