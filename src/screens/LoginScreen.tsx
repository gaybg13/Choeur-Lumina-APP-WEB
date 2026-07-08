import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch {
      setError("Connexion impossible. Vérifie ton adresse e-mail et ton mot de passe.");
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <img className="login-logo" src="/icons/icon-512.png" alt="Chœur Lumina" />
        <h1>Chœur Lumina</h1>
        <p>Notre voix, notre lumière.</p>

        <form onSubmit={submit}>
          <label>
            Adresse e-mail
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            Mot de passe
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </label>

          {error && <p className="error">{error}</p>}
          <button className="primary-button" type="submit">Se connecter</button>
        </form>
      </section>
    </main>
  );
}