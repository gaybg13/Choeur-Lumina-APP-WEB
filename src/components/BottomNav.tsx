export type Tab =
  | "home"
  | "songs"
  | "agenda"
  | "messages"
  | "members"
  | "admin"
  | "profile";

const items: Array<{ id: Exclude<Tab, "admin">; label: string }> = [
  { id: "home", label: "Accueil" },
  { id: "songs", label: "Chants" },
  { id: "agenda", label: "Agenda" },
  { id: "messages", label: "Msgs" },
  { id: "members", label: "Trombi" },
  { id: "profile", label: "Profil" }
];

function MaterialNavIcon({ id }: { id: Exclude<Tab, "admin"> }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 26,
    height: 26,
    fill: "currentColor",
    "aria-hidden": true
  } as const;

  switch (id) {
    case "home":
      return <svg {...common}><path d="M12 3 2.5 11.2l1.3 1.5L5 11.7V21h5v-6h4v6h5v-9.3l1.2 1 1.3-1.5L12 3Z" /></svg>;
    case "songs":
      return <svg {...common}><path d="M4 4h2v16H4V4Zm4-2h2v20H8V2Zm4 3h8v14h-8V5Zm5 2v6.3a3 3 0 1 0 2 2.8V9h1V7h-3Z" /></svg>;
    case "agenda":
      return <svg {...common}><path d="M7 2h2v2h6V2h2v2h1a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1V2Zm11 7H6v10h12V9Zm-9 2h2v2H9v-2Zm4 0h2v2h-2v-2Zm4 0h1v2h-1v-2Zm-8 4h2v2H9v-2Zm4 0h2v2h-2v-2Z" /></svg>;
    case "messages":
      return <svg {...common}><path d="M4 3h13a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5 4v-4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm2 4v2h9V7H6Zm0 4v2h7v-2H6Z" /></svg>;
    case "members":
      return <svg {...common}><path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 16h16V5H4v14Zm2-2 3.8-4.6 2.7 3.2 1.9-2.3L18 17H6Zm2.5-6A2.5 2.5 0 1 0 8.5 6a2.5 2.5 0 0 0 0 5Z" /></svg>;
    case "profile":
      return <svg {...common}><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5C21 16.5 17 14 12 14Z" /></svg>;
  }
}

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
              <MaterialNavIcon id={item.id} />
              {badge && <i className="badge-dot" />}
            </span>
            <small>{item.label}</small>
          </button>
        );
      })}
    </nav>
  );
}
