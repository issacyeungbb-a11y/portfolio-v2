type NavIconName = 'dashboard' | 'assets' | 'trends' | 'transactions' | 'funds' | 'analysis';

interface NavIconProps {
  name: NavIconName;
}

function DashboardIcon() {
  return (
    <>
      <rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13" y="4.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="4.5" y="13" width="6.5" height="6.5" rx="1.5" />
      <rect x="13" y="13" width="6.5" height="6.5" rx="1.5" />
    </>
  );
}

function AssetsIcon() {
  return (
    <>
      <path d="M6.5 9.5h11" />
      <path d="M6.5 14.5h11" />
      <path d="M8.5 5.5h7l2 4H6.5z" />
      <path d="M7.25 14.5h9.5l-1 4h-7.5z" />
    </>
  );
}

function TrendsIcon() {
  return (
    <>
      <path d="M5 17.5h14.5" />
      <path d="M6 15l4-4 3 2.25 5.5-5.75" />
      <path d="M15.5 7.5h3v3" />
    </>
  );
}

function TransactionsIcon() {
  return (
    <>
      <path d="M6 7h12" />
      <path d="M6 12h12" />
      <path d="M6 17h8" />
      <circle cx="17" cy="17" r="1.2" />
    </>
  );
}

function FundsIcon() {
  return (
    <>
      <path d="M5.5 9.5h13" />
      <path d="M5.5 14.5h13" />
      <path d="M8 7.5V6h9v1.5" />
      <path d="M8 16.5V18h9v-1.5" />
      <path d="M11.5 11.5v-3l2 1.5-2 1.5z" />
    </>
  );
}

function AnalysisIcon() {
  return (
    <>
      <path d="M6.5 5.5h8l3 3v10h-11z" />
      <path d="M14.5 5.5v3h3" />
      <path d="M8.5 12h6" />
      <path d="M8.5 15h6" />
    </>
  );
}

export function NavIcon({ name }: NavIconProps) {
  return (
    <svg
      className="nav-icon-svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === 'dashboard' ? <DashboardIcon /> : null}
      {name === 'assets' ? <AssetsIcon /> : null}
      {name === 'trends' ? <TrendsIcon /> : null}
      {name === 'transactions' ? <TransactionsIcon /> : null}
      {name === 'funds' ? <FundsIcon /> : null}
      {name === 'analysis' ? <AnalysisIcon /> : null}
    </svg>
  );
}
