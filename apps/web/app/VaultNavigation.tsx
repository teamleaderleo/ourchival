export type VaultView = "all" | "images" | "links" | "favorites";

export const viewLabels: Record<VaultView, string> = {
  all: "Library",
  images: "Images",
  links: "Links",
  favorites: "Favorites",
};

export function VaultSidebar({
  activeView,
  counts,
  onChange,
}: {
  activeView: VaultView;
  counts: Record<VaultView, number>;
  onChange: (view: VaultView) => void;
}) {
  return (
    <aside className="vault-sidebar" aria-label="Vault navigation">
      <nav>
        <p className="nav-label">Library</p>
        <VaultNavButton
          label="All references"
          count={counts.all}
          active={activeView === "all"}
          onClick={() => onChange("all")}
        />
        <VaultNavButton
          label="Images"
          count={counts.images}
          active={activeView === "images"}
          onClick={() => onChange("images")}
        />
        <VaultNavButton
          label="Links"
          count={counts.links}
          active={activeView === "links"}
          onClick={() => onChange("links")}
        />
        <VaultNavButton
          label="Favorites"
          count={counts.favorites}
          active={activeView === "favorites"}
          onClick={() => onChange("favorites")}
          icon="★"
        />
      </nav>
      <div className="planned-nav" aria-label="Planned workflow areas">
        <p className="nav-label">Workflow</p>
        {["Inbox", "Later", "Boards", "Archive"].map((label) => (
          <div
            className="planned-nav-item"
            title={`${label} is planned for the next workflow slice`}
            key={label}
          >
            <span>{label}</span>
            <span>Soon</span>
          </div>
        ))}
      </div>
      <div className="sidebar-note">
        <p className="eyebrow">Capture loop</p>
        <p>Right-click an image, link, or page in Edge to send it here.</p>
      </div>
    </aside>
  );
}

function VaultNavButton({
  label,
  count,
  active,
  onClick,
  icon,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: string;
}) {
  return (
    <button
      type="button"
      className={`nav-button ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="nav-button-label">
        <span className="nav-icon" aria-hidden="true">
          {icon ?? "•"}
        </span>
        {label}
      </span>
      <span className="nav-count">{count}</span>
    </button>
  );
}
