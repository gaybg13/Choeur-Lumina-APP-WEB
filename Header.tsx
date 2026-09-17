type Props = { title: string };

export function Header({ title }: Props) {
  return (
    <header className="lumina-header">
      <img src="/icons/icon-192.png" alt="Logo Chœur Lumina" />
      <div>
        <span>Chœur Lumina</span>
        <strong>{title}</strong>
      </div>
    </header>
  );
}