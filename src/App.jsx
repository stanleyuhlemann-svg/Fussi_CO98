import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState('anmelden')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)

      if (event === 'PASSWORD_RECOVERY') {
        setMode('update-password')
        setMessage('Bitte legen Sie jetzt ein neues Passwort fest.')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  function resetFeedback() {
    setMessage('')
    setError('')
  }

  async function handleLogin(event) {
    event.preventDefault()
    resetFeedback()

    const { error: loginError } =
      await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

    if (loginError) {
      setError(loginError.message)
    }
  }

  async function handleRegister(event) {
    event.preventDefault()
    resetFeedback()

    if (!displayName.trim()) {
      setError('Bitte geben Sie einen Anzeigenamen ein.')
      return
    }

    if (password.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen lang sein.')
      return
    }

    if (password !== passwordRepeat) {
      setError('Die beiden Passwörter stimmen nicht überein.')
      return
    }

    const { data, error: registerError } =
      await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
          },
          emailRedirectTo: window.location.origin,
        },
      })

    if (registerError) {
      setError(registerError.message)
      return
    }

    if (!data.session) {
      setMessage(
        'Registrierung erfolgreich. Bitte bestätigen Sie die E-Mail über den zugesandten Link.'
      )
      return
    }

    setMessage('Registrierung erfolgreich.')
  }

  async function handleForgotPassword(event) {
    event.preventDefault()
    resetFeedback()

    if (!email.trim()) {
      setError('Bitte geben Sie zuerst Ihre E-Mail-Adresse ein.')
      return
    }

    const { error: resetError } =
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      })

    if (resetError) {
      setError(resetError.message)
      return
    }

    setMessage(
      'Die E-Mail zum Zurücksetzen des Passworts wurde versendet.'
    )
  }

  async function handleUpdatePassword(event) {
    event.preventDefault()
    resetFeedback()

    if (password.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen lang sein.')
      return
    }

    if (password !== passwordRepeat) {
      setError('Die beiden Passwörter stimmen nicht überein.')
      return
    }

    const { error: updateError } =
      await supabase.auth.updateUser({
        password,
      })

    if (updateError) {
      setError(updateError.message)
      return
    }

    setPassword('')
    setPasswordRepeat('')
    setMode('login')
    setMessage('Das neue Passwort wurde erfolgreich gespeichert.')
  }

  async function handleLogout() {
    resetFeedback()
    await supabase.auth.signOut()
    setMode('login')
    setEmail('')
    setPassword('')
    setPasswordRepeat('')
  }

  if (loading) {
    return (
      <main className="center-screen">
        <p>CO98 wird geladen …</p>
      </main>
    )
  }

  if (mode === 'update-password') {
    return (
      <main className="center-screen">
        <section className="auth-card">
          <div className="brand">
            <div className="brand-mark">CO98</div>
            <h1>Neues Passwort</h1>
            <p>Calidad óptica · seit 1998</p>
          </div>

          <form onSubmit={handleUpdatePassword}>
            <label>
              Neues Passwort
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            <label>
              Passwort wiederholen
              <input
                type="password"
                value={passwordRepeat}
                onChange={(event) =>
                  setPasswordRepeat(event.target.value)
                }
                autoComplete="new-password"
                required
              />
            </label>

            {message && <p className="message success">{message}</p>}
            {error && <p className="message error">{error}</p>}

            <button type="submit" className="primary-button">
              Neues Passwort speichern
            </button>
          </form>
        </section>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="center-screen">
        <section className="auth-card">
          <div className="brand">
            <div className="brand-mark">CO98</div>
            <h1>CO98 Fussi</h1>
            <p>Calidad óptica · seit 1998</p>
          </div>

          {mode === 'login' && (
            <form onSubmit={handleLogin}>
              <label>
                E-Mail-Adresse
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                Passwort
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>

              {message && <p className="message success">{message}</p>}
              {error && <p className="message error">{error}</p>}

              <button type="submit" className="primary-button">
                Anmelden
              </button>

              <button
                type="button"
                className="text-button"
                onClick={() => {
                  resetFeedback()
                  setMode('forgot-password')
                }}
              >
                Passwort vergessen?
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  resetFeedback()
                  setMode('register')
                }}
              >
                Neues Konto erstellen
              </button>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister}>
              <label>
                Anzeigename
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) =>
                    setDisplayName(event.target.value)
                  }
                  autoComplete="nickname"
                  required
                />
              </label>

              <label>
                E-Mail-Adresse
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                Passwort
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>

              <label>
                Passwort wiederholen
                <input
                  type="password"
                  value={passwordRepeat}
                  onChange={(event) =>
                    setPasswordRepeat(event.target.value)
                  }
                  autoComplete="new-password"
                  required
                />
              </label>

              {message && <p className="message success">{message}</p>}
              {error && <p className="message error">{error}</p>}

              <button type="submit" className="primary-button">
                Registrieren
              </button>

              <button
                type="button"
                className="text-button"
                onClick={() => {
                  resetFeedback()
                  setMode('login')
                }}
              >
                Zurück zur Anmeldung
              </button>
            </form>
          )}

          {mode === 'forgot-password' && (
            <form onSubmit={handleForgotPassword}>
              <h2>Passwort zurücksetzen</h2>
              <p className="form-info">
                Geben Sie die E-Mail-Adresse des Kontos ein.
              </p>

              <label>
                E-Mail-Adresse
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              {message && <p className="message success">{message}</p>}
              {error && <p className="message error">{error}</p>}

              <button type="submit" className="primary-button">
                Reset-Link senden
              </button>

              <button
                type="button"
                className="text-button"
                onClick={() => {
                  resetFeedback()
                  setMode('login')
                }}
              >
                Zurück zur Anmeldung
              </button>
            </form>
          )}
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <strong>CO98 Fussi</strong>
          <span>Calidad óptica · seit 1998</span>
        </div>

        <button
          type="button"
          className="logout-button"
          onClick={handleLogout}
        >
          Abmelden
        </button>
      </header>

      <main className="app-content">
        {tab === 'anmelden' && (
          <section className="content-card">
            <h1>⚽ Anmelden</h1>
            <p>
              Der nächste Spieltag und die Teilnehmerliste werden hier
              angezeigt.
            </p>
          </section>
        )}

        {tab === 'runden' && (
          <section className="content-card">
            <h1>🎲 Runden</h1>
            <p>
              Hier folgen Spielformat, ELO-Auslosung und Ergebnis.
            </p>
          </section>
        )}

        {tab === 'ranking' && (
          <section className="content-card">
            <h1>🏆 Ranking</h1>
            <p>
              Punkte, Spiele, Siege, Unentschieden und ELO werden hier
              angezeigt.
            </p>
          </section>
        )}
      </main>

      <nav className="bottom-navigation">
        <button
          type="button"
          className={tab === 'anmelden' ? 'active' : ''}
          onClick={() => setTab('anmelden')}
        >
          ⚽
          <span>Anmelden</span>
        </button>

        <button
          type="button"
          className={tab === 'runden' ? 'active' : ''}
          onClick={() => setTab('runden')}
        >
          🎲
          <span>Runden</span>
        </button>

        <button
          type="button"
          className={tab === 'ranking' ? 'active' : ''}
          onClick={() => setTab('ranking')}
        >
          🏆
          <span>Ranking</span>
        </button>
      </nav>
    </div>
  )
}
