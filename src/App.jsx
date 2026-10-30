import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const TEAM_SIZES = [3, 4, 5, 6]

function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

function formatTime(value) {
  return value ? String(value).slice(0, 5) : ''
}

function shuffle(items) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function averageElo(players) {
  if (!players.length) return 0
  return Math.round(players.reduce((sum, p) => sum + Number(p.elo || 1000), 0) / players.length)
}

function combinations(items, size) {
  const result = []
  function build(start, current) {
    if (current.length === size) {
      result.push([...current])
      return
    }
    for (let i = start; i < items.length; i += 1) {
      current.push(items[i])
      build(i + 1, current)
      current.pop()
    }
  }
  build(0, [])
  return result
}

function buildBalancedTeams(participants, teamSize) {
  const randomized = shuffle(participants)
  const teamACount = Math.floor(randomized.length / 2)
  let candidates = combinations(randomized, teamACount)
  if (candidates.length > 100000) {
    candidates = candidates.sort(() => Math.random() - 0.5).slice(0, 100000)
  }

  let best = null
  for (const teamA of candidates) {
    const ids = new Set(teamA.map((p) => p.key))
    const teamB = randomized.filter((p) => !ids.has(p.key))
    const difference = Math.abs(averageElo(teamA) - averageElo(teamB))
    if (!best || difference < best.difference) best = { teamA, teamB, difference }
  }

  if (!best) return { teamA: [], teamB: [] }
  return {
    teamA: shuffle(best.teamA).map((p, index) => ({ ...p, is_backup: index >= teamSize })),
    teamB: shuffle(best.teamB).map((p, index) => ({ ...p, is_backup: index >= teamSize })),
  }
}

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('login')
  const [tab, setTab] = useState('anmelden')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [matchDays, setMatchDays] = useState([])
  const [selectedDayId, setSelectedDayId] = useState(null)
  const [registrations, setRegistrations] = useState([])
  const [guests, setGuests] = useState([])
  const [round, setRound] = useState(null)
  const [teamMembers, setTeamMembers] = useState([])
  const [ranking, setRanking] = useState([])

  const [newMatchDate, setNewMatchDate] = useState('')
  const [newMatchTime, setNewMatchTime] = useState('19:00')
  const [teamSize, setTeamSize] = useState(4)
  const [guestName, setGuestName] = useState('')
  const [guestElo, setGuestElo] = useState('1000')

  const selectedDay = useMemo(
    () => matchDays.find((d) => String(d.id) === String(selectedDayId)) || null,
    [matchDays, selectedDayId]
  )

  const registeredPlayers = useMemo(
    () => registrations
      .filter((r) => r.status === 'registered')
      .sort((a, b) => String(a.profiles?.display_name || '').localeCompare(String(b.profiles?.display_name || ''), 'de')),
    [registrations]
  )

  const participants = useMemo(() => {
    const players = registeredPlayers.map((r) => ({
      key: `player-${r.player_id}`,
      type: 'player',
      id: r.player_id,
      display_name: r.profiles?.display_name || 'Spieler',
      elo: Number(r.profiles?.elo || 1000),
    }))
    const guestItems = guests.map((g) => ({
      key: `guest-${g.id}`,
      type: 'guest',
      id: g.id,
      display_name: g.display_name,
      elo: Number(g.elo),
    }))
    return [...players, ...guestItems]
  }, [registeredPlayers, guests])

  const ownRegistration = useMemo(
    () => session ? registrations.find((r) => r.player_id === session.user.id) : null,
    [registrations, session]
  )

  const isRegistered = ownRegistration?.status === 'registered'
  const teamA = teamMembers.filter((m) => m.team === 'A')
  const teamB = teamMembers.filter((m) => m.team === 'B')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'PASSWORD_RECOVERY') {
        setMode('update-password')
        setMessage('Bitte legen Sie jetzt ein neues Passwort fest.')
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    loadInitialData()
  }, [session])

  useEffect(() => {
    if (session && selectedDayId) loadDay(selectedDayId)
  }, [session, selectedDayId])

  function resetFeedback() {
    setMessage('')
    setError('')
  }

  async function loadInitialData() {
    setLoading(true)
    resetFeedback()
    const [{ data: profileData, error: profileError }, { data: daysData, error: daysError }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('match_days').select('*').order('match_date').order('start_time'),
    ])
    if (profileError || daysError) {
      setError((profileError || daysError).message)
      setLoading(false)
      return
    }
    setProfile(profileData)
    setMatchDays(daysData || [])
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const next = (daysData || []).find((d) => new Date(`${d.match_date}T12:00:00`) >= today && d.status !== 'finished') || daysData?.[0]
    if (next) setSelectedDayId(next.id)
    await loadRanking()
    setLoading(false)
  }

  async function loadDay(dayId) {
    resetFeedback()
    const [regResult, guestResult, roundResult] = await Promise.all([
      supabase.from('registrations').select('*, profiles(id, display_name, elo, is_admin)').eq('match_day_id', dayId),
      supabase.from('guest_players').select('*').eq('match_day_id', dayId).order('created_at'),
      supabase.from('rounds').select('*').eq('match_day_id', dayId).order('created_at', { ascending: false }).limit(1),
    ])
    const firstError = regResult.error || guestResult.error || roundResult.error
    if (firstError) return setError(firstError.message)
    setRegistrations(regResult.data || [])
    setGuests(guestResult.data || [])
    const currentRound = roundResult.data?.[0] || null
    setRound(currentRound)

    if (!currentRound) {
      setTeamMembers([])
      return
    }

    const { data, error: membersError } = await supabase
      .from('team_members')
      .select('*, profiles(id, display_name, elo), guest_players(id, display_name, elo)')
      .eq('round_id', currentRound.id)
    if (membersError) return setError(membersError.message)
    setTeamMembers((data || []).map((m) => ({
      ...m,
      display_name: m.profiles?.display_name || m.guest_players?.display_name || 'Teilnehmer',
      elo: Number(m.elo_before || m.profiles?.elo || m.guest_players?.elo || 1000),
      is_guest: Boolean(m.guest_player_id),
    })))
    setTeamSize(currentRound.team_size)
  }

  async function loadRanking() {
    const [profilesResult, resultsResult] = await Promise.all([
      supabase.from('profiles').select('id, display_name, elo'),
      supabase.from('player_results').select('player_id, result, attendance_points, result_points'),
    ])
    if (profilesResult.error || resultsResult.error) return
    const map = new Map((profilesResult.data || []).map((p) => [p.id, {
      ...p, games: 0, wins: 0, draws: 0, losses: 0, points: 0,
    }]))
    for (const result of resultsResult.data || []) {
      const player = map.get(result.player_id)
      if (!player) continue
      player.games += 1
      player.points += Number(result.attendance_points || 0) + Number(result.result_points || 0)
      if (result.result === 'win') player.wins += 1
      if (result.result === 'draw') player.draws += 1
      if (result.result === 'loss') player.losses += 1
    }
    setRanking([...map.values()].sort((a, b) => b.points - a.points || b.elo - a.elo))
  }

  async function handleLogin(event) {
    event.preventDefault(); resetFeedback()
    const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (e) setError(e.message)
  }

  async function handleRegister(event) {
    event.preventDefault(); resetFeedback()
    if (!displayName.trim()) return setError('Bitte geben Sie einen Anzeigenamen ein.')
    if (password.length < 6) return setError('Das Passwort muss mindestens 6 Zeichen lang sein.')
    if (password !== passwordRepeat) return setError('Die beiden Passwörter stimmen nicht überein.')
    const { data, error: e } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { display_name: displayName.trim() }, emailRedirectTo: window.location.origin },
    })
    if (e) return setError(e.message)
    setMessage(data.session ? 'Registrierung erfolgreich.' : 'Registrierung erfolgreich. Bitte bestätigen Sie die E-Mail über den zugesandten Link.')
  }

  async function handleForgotPassword(event) {
    event.preventDefault(); resetFeedback()
    if (!email.trim()) return setError('Bitte geben Sie zuerst Ihre E-Mail-Adresse ein.')
    const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
    if (e) return setError(e.message)
    setMessage('Die E-Mail zum Zurücksetzen des Passworts wurde versendet.')
  }

  async function handleUpdatePassword(event) {
    event.preventDefault(); resetFeedback()
    if (password.length < 6) return setError('Das Passwort muss mindestens 6 Zeichen lang sein.')
    if (password !== passwordRepeat) return setError('Die beiden Passwörter stimmen nicht überein.')
    const { error: e } = await supabase.auth.updateUser({ password })
    if (e) return setError(e.message)
    setPassword(''); setPasswordRepeat(''); setMode('login')
    setMessage('Das neue Passwort wurde erfolgreich gespeichert.')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setMode('login'); setEmail(''); setPassword(''); setPasswordRepeat('')
  }

  async function registerForDay() {
    if (!selectedDay) return
    setBusy(true); resetFeedback()
    const { error: e } = await supabase.from('registrations').upsert({
      match_day_id: selectedDay.id, player_id: session.user.id, status: 'registered',
    }, { onConflict: 'match_day_id,player_id' })
    if (e) setError(e.message)
    else { setMessage('Sie sind für diesen Spieltag angemeldet.'); await loadDay(selectedDay.id) }
    setBusy(false)
  }

  async function cancelRegistration() {
    setBusy(true); resetFeedback()
    const { error: e } = await supabase.from('registrations').update({ status: 'cancelled' })
      .eq('match_day_id', selectedDay.id).eq('player_id', session.user.id)
    if (e) setError(e.message)
    else { setMessage('Sie sind für diesen Spieltag abgemeldet.'); await loadDay(selectedDay.id) }
    setBusy(false)
  }

  async function addGuest(event) {
    event.preventDefault(); resetFeedback()
    if (!selectedDay) return setError('Bitte zuerst einen Spieltag auswählen.')
    if (round) return setError('Bitte zuerst die bestehende Auslosung löschen.')
    const name = guestName.trim()
    const elo = Number(guestElo)
    if (!name) return setError('Bitte einen Gastnamen eingeben.')
    if (!Number.isInteger(elo) || elo < 500 || elo > 2000) return setError('Bitte eine ELO zwischen 500 und 2000 eingeben.')
    setBusy(true)
    const { error: e } = await supabase.from('guest_players').insert({
      match_day_id: selectedDay.id, display_name: name, elo, created_by: session.user.id,
    })
    if (e) setError(e.message)
    else {
      setGuestName(''); setGuestElo('1000')
      setMessage(`${name} wurde als Gast hinzugefügt.`)
      await loadDay(selectedDay.id)
    }
    setBusy(false)
  }

  async function removeGuest(guest) {
    if (round) return setError('Bitte zuerst die bestehende Auslosung löschen.')
    if (!window.confirm(`${guest.display_name} wirklich als Gast entfernen?`)) return
    setBusy(true); resetFeedback()
    const { error: e } = await supabase.from('guest_players').delete().eq('id', guest.id)
    if (e) setError(e.message)
    else { setMessage(`${guest.display_name} wurde entfernt.`); await loadDay(selectedDay.id) }
    setBusy(false)
  }

  async function removePlayer(registration) {
    if (!profile?.is_admin || !window.confirm(`${registration.profiles?.display_name} wirklich vom Spieltag entfernen?`)) return
    setBusy(true); resetFeedback()
    const { error: e } = await supabase.from('registrations').delete().eq('id', registration.id)
    if (e) setError(e.message)
    else { setMessage('Spieler wurde entfernt.'); await loadDay(selectedDay.id) }
    setBusy(false)
  }

  async function createMatchDay(event) {
    event.preventDefault(); resetFeedback()
    if (!newMatchDate) return setError('Bitte ein Datum auswählen.')
    setBusy(true)
    const { data, error: e } = await supabase.from('match_days').insert({
      match_date: newMatchDate, start_time: newMatchTime || '19:00', status: 'open',
    }).select().single()
    if (e) setError(e.message)
    else {
      setNewMatchDate(''); setNewMatchTime('19:00')
      await loadInitialData(); setSelectedDayId(data.id)
      setMessage('Der neue Spieltag wurde angelegt.')
    }
    setBusy(false)
  }

  async function deleteMatchDay() {
    if (!profile?.is_admin || !window.confirm(`${formatDate(selectedDay.match_date)} wirklich komplett löschen?`)) return
    setBusy(true); resetFeedback()
    const { error: e } = await supabase.from('match_days').delete().eq('id', selectedDay.id)
    if (e) setError(e.message)
    else { setSelectedDayId(null); setMessage('Der Spieltag wurde gelöscht.'); await loadInitialData() }
    setBusy(false)
  }

  async function drawTeams() {
    resetFeedback()
    if (!profile?.is_admin) return
    if (round) return setError('Für diesen Spieltag existiert bereits eine Auslosung.')
    const needed = teamSize * 2
    if (participants.length < needed) return setError(`Für ${teamSize} vs. ${teamSize} werden mindestens ${needed} Teilnehmer benötigt.`)
    setBusy(true)
    const balanced = buildBalancedTeams(participants, teamSize)
    const { data: roundData, error: roundError } = await supabase.from('rounds').insert({
      match_day_id: selectedDay.id, team_size: teamSize, status: 'drawn',
    }).select().single()
    if (roundError) { setError(roundError.message); setBusy(false); return }

    const toRows = (team, teamName) => team.map((p) => ({
      round_id: roundData.id,
      player_id: p.type === 'player' ? p.id : null,
      guest_player_id: p.type === 'guest' ? p.id : null,
      team: teamName,
      is_backup: p.is_backup,
      elo_before: p.elo,
    }))
    const { error: memberError } = await supabase.from('team_members').insert([
      ...toRows(balanced.teamA, 'A'), ...toRows(balanced.teamB, 'B'),
    ])
    if (memberError) {
      await supabase.from('rounds').delete().eq('id', roundData.id)
      setError(memberError.message); setBusy(false); return
    }
    await supabase.from('match_days').update({ status: 'drawn' }).eq('id', selectedDay.id)
    setMessage(`${teamSize} vs. ${teamSize} wurde ELO-ausgeglichen ausgelost.`)
    await loadInitialData(); setSelectedDayId(selectedDay.id); await loadDay(selectedDay.id)
    setBusy(false)
  }

  async function deleteDraw() {
    if (!profile?.is_admin || !round || !window.confirm('Auslosung wirklich löschen?')) return
    setBusy(true); resetFeedback()
    const { error: e } = await supabase.from('rounds').delete().eq('id', round.id)
    if (e) setError(e.message)
    else {
      await supabase.from('match_days').update({ status: 'open' }).eq('id', selectedDay.id)
      setMessage('Auslosung gelöscht. Gäste und Spieler können geändert werden.')
      await loadDay(selectedDay.id)
    }
    setBusy(false)
  }

  if (loading) return <main className="center-screen"><p>CO98 wird geladen …</p></main>

  if (mode === 'update-password') return (
    <main className="center-screen"><section className="auth-card">
      <div className="brand"><div className="brand-mark">CO98</div><h1>Neues Passwort</h1><p>Calidad óptica · seit 1998</p></div>
      <form onSubmit={handleUpdatePassword}>
        <label>Neues Passwort<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <label>Passwort wiederholen<input type="password" value={passwordRepeat} onChange={(e) => setPasswordRepeat(e.target.value)} required /></label>
        {message && <p className="message success">{message}</p>}{error && <p className="message error">{error}</p>}
        <button className="primary-button">Neues Passwort speichern</button>
      </form>
    </section></main>
  )

  if (!session) return (
    <main className="center-screen"><section className="auth-card">
      <div className="brand"><div className="brand-mark">CO98</div><h1>CO98 Fussi</h1><p>Calidad óptica · seit 1998</p></div>
      {mode === 'login' && <form onSubmit={handleLogin}>
        <label>E-Mail-Adresse<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Passwort<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {message && <p className="message success">{message}</p>}{error && <p className="message error">{error}</p>}
        <button className="primary-button">Anmelden</button>
        <button type="button" className="text-button" onClick={() => setMode('forgot-password')}>Passwort vergessen?</button>
        <button type="button" className="secondary-button" onClick={() => setMode('register')}>Neues Konto erstellen</button>
      </form>}
      {mode === 'register' && <form onSubmit={handleRegister}>
        <label>Anzeigename<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></label>
        <label>E-Mail-Adresse<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Passwort<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <label>Passwort wiederholen<input type="password" value={passwordRepeat} onChange={(e) => setPasswordRepeat(e.target.value)} required /></label>
        {message && <p className="message success">{message}</p>}{error && <p className="message error">{error}</p>}
        <button className="primary-button">Registrieren</button>
        <button type="button" className="text-button" onClick={() => setMode('login')}>Zurück zur Anmeldung</button>
      </form>}
      {mode === 'forgot-password' && <form onSubmit={handleForgotPassword}>
        <h2>Passwort zurücksetzen</h2>
        <label>E-Mail-Adresse<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        {message && <p className="message success">{message}</p>}{error && <p className="message error">{error}</p>}
        <button className="primary-button">Reset-Link senden</button>
        <button type="button" className="text-button" onClick={() => setMode('login')}>Zurück zur Anmeldung</button>
      </form>}
    </section></main>
  )

  return (
    <div className="app-shell">
      <header className="app-header"><div><strong>CO98 Fussi</strong><span>Calidad óptica · seit 1998{profile?.is_admin ? ' · Admin' : ''}</span></div><button className="logout-button" onClick={handleLogout}>Abmelden</button></header>
      <main className="app-content">
        {message && <p className="message success">{message}</p>}{error && <p className="message error">{error}</p>}

        {tab === 'anmelden' && <>
          <section className="content-card">
            <h1>⚽ Anmelden</h1>
            {matchDays.length === 0 ? <p>Noch kein Spieltag angelegt.</p> : <>
              <label>Spieltag<select value={selectedDayId || ''} onChange={(e) => setSelectedDayId(Number(e.target.value))}>{matchDays.map((d) => <option key={d.id} value={d.id}>{formatDate(d.match_date)} · {formatTime(d.start_time)} Uhr</option>)}</select></label>
              {selectedDay && <div style={{ marginTop: 20, padding: 18, borderRadius: 16, background: '#f5f5f5' }}>
                <strong style={{ display: 'block', fontSize: 20 }}>{formatDate(selectedDay.match_date)}</strong><span>Beginn: {formatTime(selectedDay.start_time)} Uhr</span>
                <div style={{ marginTop: 18 }}>{!isRegistered ? <button className="primary-button" disabled={busy} onClick={registerForDay}>✅ Ich bin dabei</button> : <button className="secondary-button" disabled={busy} onClick={cancelRegistration}>Abmelden</button>}</div>
              </div>}
            </>}
          </section>

          {selectedDay && <section className="content-card">
            <h2>Angemeldete Teilnehmer ({participants.length})</h2>
            {participants.length === 0 ? <p>Noch niemand angemeldet.</p> : participants.map((p, index) => (
              <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 11, borderRadius: 10, background: '#f5f5f5', marginBottom: 8 }}>
                <strong>{index + 1}. {p.display_name}{p.type === 'guest' ? ` · Gast · ELO ${p.elo}` : ''}</strong>
                {p.type === 'guest' ? <button disabled={busy || Boolean(round)} onClick={() => removeGuest(guests.find((g) => g.id === p.id))}>Gast entfernen</button> : profile?.is_admin ? <button disabled={busy} onClick={() => removePlayer(registeredPlayers.find((r) => r.player_id === p.id))}>Vom Spieltag entfernen</button> : null}
              </div>
            ))}
          </section>}

          {selectedDay && <section className="content-card">
            <h2>👤 Gastspieler</h2>
            {round ? <p>Zum Ändern der Gäste bitte zuerst die Auslosung löschen.</p> : <form onSubmit={addGuest}>
              <label>Name<input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="z. B. Gast 1 oder Pedro" required /></label>
              <label>Geschätzte ELO<input type="number" min="500" max="2000" step="1" value={guestElo} onChange={(e) => setGuestElo(e.target.value)} required /></label>
              <button className="primary-button" disabled={busy}>+ Gastspieler hinzufügen</button>
            </form>}
          </section>}

          {profile?.is_admin && <section className="content-card">
            <h2>⚙️ Admin · Spieltage</h2>
            <form onSubmit={createMatchDay}>
              <label>Datum<input type="date" value={newMatchDate} onChange={(e) => setNewMatchDate(e.target.value)} required /></label>
              <label>Beginn<input type="time" value={newMatchTime} onChange={(e) => setNewMatchTime(e.target.value)} required /></label>
              <button className="primary-button" disabled={busy}>+ Spieltag anlegen</button>
            </form>
            {selectedDay && <button style={{ marginTop: 18, width: '100%' }} disabled={busy} onClick={deleteMatchDay}>Spieltag löschen</button>}
          </section>}
        </>}

        {tab === 'runden' && <>
          <section className="content-card"><h1>🎲 Runden</h1>
            {!selectedDay ? <p>Bitte zuerst einen Spieltag auswählen.</p> : <p><strong>{formatDate(selectedDay.match_date)}</strong> · {participants.length} Teilnehmer</p>}
            {!round && profile?.is_admin && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 18 }}>{TEAM_SIZES.map((size) => <button key={size} onClick={() => setTeamSize(size)}>{size} vs. {size}</button>)}</div><button className="primary-button" onClick={drawTeams}>🎲 Mannschaften auslosen</button></>}
          </section>
          {round && <><TeamCard title="⚫ Team A" members={teamA} /><TeamCard title="⚪ Team B" members={teamB} />{profile?.is_admin && <section className="content-card"><button onClick={deleteDraw}>🗑️ Auslosung löschen</button></section>}</>}
        </>}

        {tab === 'ranking' && <section className="content-card"><h1>🏆 Ranking</h1><p>Gastspieler werden hier bewusst nicht geführt.</p><div style={{ overflowX: 'auto' }}><table><thead><tr><th>#</th><th>Spieler</th><th>Sp.</th><th>S</th><th>U</th><th>N</th><th>Punkte</th><th>ELO</th></tr></thead><tbody>{ranking.map((p, i) => <tr key={p.id}><td>{i + 1}.</td><td>{p.display_name}</td><td>{p.games}</td><td>{p.wins}</td><td>{p.draws}</td><td>{p.losses}</td><td>{p.points}</td><td>{p.elo}</td></tr>)}</tbody></table></div></section>}
      </main>
      <nav className="bottom-navigation">
        <button className={tab === 'anmelden' ? 'active' : ''} onClick={() => setTab('anmelden')}>⚽ <span>Anmelden</span></button>
        <button className={tab === 'runden' ? 'active' : ''} onClick={() => setTab('runden')}>🎲 <span>Runden</span></button>
        <button className={tab === 'ranking' ? 'active' : ''} onClick={() => { setTab('ranking'); loadRanking() }}>🏆 <span>Ranking</span></button>
      </nav>
    </div>
  )
}

function TeamCard({ title, members }) {
  return <section className="content-card"><h2>{title}</h2><p>Ø ELO: {averageElo(members)}</p>{members.map((m, i) => <div key={m.id} style={{ padding: '9px 0', borderBottom: '1px solid #263c54' }}><strong>{i + 1}. {m.display_name}</strong>{m.is_guest && <span> · Gast · ELO {m.elo}</span>}{m.is_backup && <span> · Backup</span>}</div>)}</section>
}
