import { CatIcon } from "./CatIcon";

export type VaultView =
  | "inbox"
  | "all"
  | "images"
  | "links"
  | "favorites"
  | "later"
  | "archive"
  | "trash";

export const viewLabels: Record<VaultView, string> = {
  inbox: "Unreviewed",
  all: "Library",
  images: "Images",
  links: "Links",
  favorites: "Favorites",
  later: "Review later",
  archive: "Archive",
  trash: "Trash",
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
      <nav aria-label="Review">
        <VaultNavButton
          label="Unreviewed"
          count={counts.inbox}
          active={activeView === "inbox"}
          onClick={() => onChange("inbox")}
          icon="inbox"
        />
      </nav>

      <nav className="sidebar-section" aria-label="Library">
        <VaultNavButton
          label="Library"
          count={counts.all}
          active={activeView === "all"}
          onClick={() => onChange("all")}
          icon="all"
        />
        <VaultNavButton
          label="Images"
          count={counts.images}
          active={activeView === "images"}
          onClick={() => onChange("images")}
          icon="images"
        />
        <VaultNavButton
          label="Links"
          count={counts.links}
          active={activeView === "links"}
          onClick={() => onChange("links")}
          icon="links"
        />
        <VaultNavButton
          label="Favorites"
          count={counts.favorites}
          active={activeView === "favorites"}
          onClick={() => onChange("favorites")}
          icon="favorites"
        />
      </nav>

      <nav className="sidebar-section" aria-label="Workflow">
        <VaultNavButton
          label="Review later"
          count={counts.later}
          active={activeView === "later"}
          onClick={() => onChange("later")}
          icon="later"
        />
        <VaultNavButton
          label="Archive"
          count={counts.archive}
          active={activeView === "archive"}
          onClick={() => onChange("archive")}
          icon="archive"
        />
        <VaultNavButton
          label="Trash"
          count={counts.trash}
          active={activeView === "trash"}
          onClick={() => onChange("trash")}
          icon="trash"
        />
      </nav>
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
  icon: VaultView;
}) {
  return (
    <button
      type="button"
      className={`nav-button ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      title={{ inbox: "All newly imported items are already saved. Browse them here before filing.", all: "Items you chose to add to your library.", images: "Image references filed in your library.", links: "Links filed in your library.", favorites: "References you starred.", later: "Items you set aside to review later.", archive: "Items stored away from your active library.", trash: "Removed from browsing and blocked from automatic recapture. Can be restored." }[icon]}
      onClick={onClick}
    >
      <span className="nav-button-label">
        <span className="nav-icon" aria-hidden="true">
          <CatIcon name={icon} />
        </span>
        {label}
      </span>
      {count > 0 && !active ? <span className="nav-count">{count.toLocaleString("en-US")}</span> : null}
    </button>
  );
}
