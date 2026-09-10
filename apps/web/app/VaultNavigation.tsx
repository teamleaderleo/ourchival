import { CatIcon } from "./CatIcon";
import { SidebarDiscover } from "./SidebarDiscover";

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
  all: "All saved",
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
  revealSensitive,
  query,
  onSearch,
}: {
  activeView: VaultView;
  counts: Record<VaultView, number>;
  onChange: (view: VaultView) => void;
  revealSensitive: boolean;
  query: string;
  onSearch: (query: string) => void;
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
          label="All saved"
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

      <SidebarDiscover revealSensitive={revealSensitive} query={query} onSearch={onSearch} />
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
      className={`nav-button ${active ? "active" : ""} ${icon === "images" || icon === "links" ? "nav-subset" : ""}`}
      aria-current={active ? "page" : undefined}
      title={{ inbox: "All newly imported items are already saved. Browse them here before filing.", all: "All saved items, including unreviewed imports.", images: "All saved images.", links: "All saved links, including OneTab imports.", favorites: "References you starred.", later: "Items you set aside to review later.", archive: "Items stored away from your active library.", trash: "Removed from browsing and blocked from automatic recapture. Can be restored." }[icon]}
      onClick={onClick}
    >
      <span className="nav-button-label">
        <span className="nav-icon" aria-hidden="true">
          <CatIcon name={icon} />
        </span>
        {label}
      </span>

    </button>
  );
}
