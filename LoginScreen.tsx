import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";

type Mode = "login" | "register";

export function LoginScreen() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [birthdayDay, setBirthdayDay] = useState("");
  const [birthdayMonth, setBirthdayMonth] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function cleanFirebaseError(err: any): string {
    const code = err?.code || "";
    if (code === "auth/invalid-credential") return "Adresse e-mail ou mot de passe incorrect.";
    if (code === "auth/email-already-in-use") return "Cette adresse e-mail possède déjà un compte.";
    if (code === "auth/weak-password") return "Le mot de passe doit contenir au moins 6 caractères.";
    if (code === "auth/invalid-email") return "L'adresse e-mail n'est pas valide.";
    if (code === "auth/network-request-failed") return "Problème de connexion Internet.";
    if (code === "auth/api-key-not-valid.-please-pass-a-valid-api-key.") {
      return "Configuration Firebase incorrecte. Recharge l'application.";
    }
    return code ? `Erreur : ${code}` : "Une erreur est survenue.";
  }

  async function login() {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }

  async function register() {
    const day = Number(birthdayDay);
    const month = Number(birthdayMonth);

    if (!inviteCode.trim()) throw new Error("CODE_INVITATION_REQUIS");
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      throw new Error("DATE_ANNIVERSAIRE_INVALIDE");
    }

    const authResult = await createUserWithEmailAndPassword(
      auth,
      email.trim(),
      password
    );

    try {
      const memberQuery = query(
        collection(db, "members"),
        where("inviteCode", "==", inviteCode.trim()),
        where("claimed", "==", false)
      );
      const snap = await getDocs(memberQuery);

      if (snap.empty) {
        await deleteUser(authResult.user);
        await signOut(auth);
        throw new Error("CODE_INVITATION_INVALIDE");
      }

      const memberDoc = snap.docs[0];
      const role = memberDoc.data().role || "membre";

      const batch = writeBatch(db);
      batch.update(memberDoc.ref, {
        uid: authResult.user.uid,
        claimed: true,
        email: email.trim(),
        birthdayDay: day,
        birthdayMonth: month
      });
      batch.set(doc(db, "userRoles", authResult.user.uid), {
        role,
        memberId: memberDoc.id
      });
      await batch.commit();
    } catch (err) {
      if (auth.currentUser) {
        try {
          await deleteUser(auth.currentUser);
        } catch {
          await signOut(auth);
        }
      }
      throw err;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);

    try {
      if (mode === "login") await login();
      else await register();
    } catch (err: any) {
      console.error("Erreur Firebase Auth :", err);
      if (err?.message === "CODE_INVITATION_REQUIS") {
        setError("Le code d'invitation est obligatoire.");
      } else if (err?.message === "CODE_INVITATION_INVALIDE") {
        setError("Code d'invitation invalide ou déjà utilisé.");
      } else if (err?.message === "DATE_ANNIVERSAIRE_INVALIDE") {
        setError("Jour ou mois d'anniversaire invalide.");
      } else {
        setError(cleanFirebaseError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setPassword("");
  }

  return (
    <main className="auth-page">
      <div className="auth-glow auth-glow-top" />
      <div className="auth-glow auth-glow-bottom" />

      <section className={`auth-panel ${mode === "register" ? "register-mode" : ""}`}>
        <div className="auth-logo-wrap">
          <img className="auth-logo" src="/icons/icon-512.png" alt="Chœur Lumina" />
        </div>

        <h1>Chœur Lumina</h1>
        <p className="auth-subtitle">
          Une interface plus élégante pour chanter,<br />
          s'organiser et échanger.
        </p>

        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && (
            <>
              <div className="auth-field">
                <input
                  aria-label="Code d'invitation"
                  placeholder="Code d'invitation"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  required
                />
              </div>

              <div className="auth-birthday-grid">
                <div className="auth-field">
                  <input
                    aria-label="Jour de naissance"
                    inputMode="numeric"
                    placeholder="Jour de naissance"
                    value={birthdayDay}
                    onChange={(e) => setBirthdayDay(e.target.value)}
                    required
                  />
                </div>

                <div className="auth-field">
                  <input
                    aria-label="Mois de naissance"
                    inputMode="numeric"
                    placeholder="Mois"
                    value={birthdayMonth}
                    onChange={(e) => setBirthdayMonth(e.target.value)}
                    required
                  />
                </div>
              </div>
            </>
          )}

          <div className="auth-field">
            <input
              aria-label="Email"
              placeholder="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="auth-field auth-password-field">
            <input
              aria-label="Mot de passe"
              placeholder="Mot de passe"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            <button
              className="auth-eye"
              type="button"
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                  <path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c5.5 0 9 5 9 5s-1.1 1.6-3 3" />
                  <path d="M6.6 6.6C4.4 8 3 10 3 10s3.5 5 9 5c1.2 0 2.3-.2 3.3-.6" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
              )}
            </button>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-primary-button" type="submit" disabled={busy}>
            {busy
              ? "Patiente..."
              : mode === "login"
                ? "Se connecter"
                : "Créer mon compte"}
          </button>
        </form>

        {mode === "login" ? (
          <button
            type="button"
            className="auth-switch-link"
            onClick={() => switchMode("register")}
          >
            J'ai un code d'invitation, créer mon compte
          </button>
        ) : (
          <>
            <p className="auth-help">
              Le code d'invitation est fourni par un administrateur du Chœur Lumina.
            </p>
            <button
              type="button"
              className="auth-switch-link"
              onClick={() => switchMode("login")}
            >
              J'ai déjà un compte, me connecter
            </button>
          </>
        )}
      </section>
    </main>
  );
}
