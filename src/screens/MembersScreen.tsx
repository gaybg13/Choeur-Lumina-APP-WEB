import { Header } from "../components/Header";
import type { Member } from "../types/models";

export function MembersScreen({ members }: { members: Member[] }) {
  const groups = members.reduce<Record<string, Member[]>>((acc, member) => {
    const key = member.pupitre || "Autres";
    if (!acc[key]) acc[key] = [];
    acc[key].push(member);
    return acc;
  }, {});

  return (
    <>
      <Header title="Trombinoscope" />
      <section className="screen">
        {Object.entries(groups).map(([voice, list]) => (
          <div key={voice} className="voice-section">
            <h2>{voice}</h2>
            <div className="member-grid">
              {list.map((member) => (
                <article key={member.id} className="member-card">
                  {member.photoUrl ? (
                    <img src={member.photoUrl} alt={`${member.prenom} ${member.nom}`} />
                  ) : (
                    <div className="avatar">{member.prenom?.[0]}{member.nom?.[0]}</div>
                  )}
                  <strong>{member.prenom}</strong>
                  <small>{member.nom}</small>
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
