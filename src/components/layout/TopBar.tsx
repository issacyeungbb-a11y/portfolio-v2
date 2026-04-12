interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar-heading">
        <h1>{title}</h1>
      </div>
    </header>
  );
}
