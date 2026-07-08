export type Tab = "home" | "songs" | "agenda" | "messages" | "members" | "profile";

const items: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "home", label: "Accueil", icon: "⌂" },
  { id: "songs", label: "Chants", icon: "♫" },
  { id: "agenda", label: "Agenda", icon: "▣" },
  { id: "messages", label: "Msgs", icon: "✉" },
  { id: "members", label: "Trombi", icon: "◉" },
  { id: "profile", label: "Profil", icon: "☺" }
];

export function BottomNav({
  active,
  onChange,
  messageUnread,
  agendaUnread
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  messageUnread: boolean;
  agendaUnread: boolean;
}) {
  return (
    <nav className="bottom-nav">
      {items.map((item) => {
        const badge =
          (item.id === "messages" && messageUnread) ||
          (item.id === "agenda" && agendaUnread);
        return (
          <button
            key={item.id}
            className={active === item.id ? "active" : ""}
            onClick={() => onChange(item.id)}
          >
            <span className="nav-icon">
              {item.icon}
              {badge && <i className="badge-dot" />}
            </span>
            <small>{item.label}</small>
          </button>
        );
      })}
    </nav>
  );
}