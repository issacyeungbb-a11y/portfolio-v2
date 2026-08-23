interface AssetSectionCollapseButtonProps {
  sectionLabel: string;
  isCollapsed: boolean;
  controls: string;
  onToggle: () => void;
}

export function AssetSectionCollapseButton({
  sectionLabel,
  isCollapsed,
  controls,
  onToggle,
}: AssetSectionCollapseButtonProps) {
  const actionLabel = isCollapsed ? '展開' : '縮小';

  return (
    <button
      className="asset-section-collapse-button"
      type="button"
      onClick={onToggle}
      aria-expanded={!isCollapsed}
      aria-controls={controls}
      aria-label={`${actionLabel}${sectionLabel}區域`}
    >
      <span aria-hidden="true">{isCollapsed ? '＋' : '−'}</span>
      {actionLabel}
    </button>
  );
}
