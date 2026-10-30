import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const TEAM_SIZES = [3, 4, 5, 6]
const RESPONSE_LABELS = { yes: 'Ich bin dabei', no: 'Ich bin nicht dabei', open: 'Noch offen' }

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
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]]
  }
  return copy
}

function averageElo(players) {
  if (!players.length) return 0
  return Math.round(players.reduce((sum, player) => sum + Number(player.elo || 1000), 0) / players.length)
}

function combinations(items, size) {
  const result = []
  function build(start, current) {
    if (current.length === size) {
      result.push([...current])
      return
    }
    for (let index = start; index < items.length; index += 1) {
      current.push(items[index])
      build(index + 1, current)
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
  if (candidates.length > 100000) candidates = shuffle(candidates).slice(0, 100000)

  let best = null
  for (const teamA of candidates) {
    const ids = new Set(teamA.map((player) => player.key))
    const teamB = randomized.filter((player) => !ids.has(player.key))
    const difference = Math.abs(averageElo(teamA) - averageElo(teamB))
    if (!best || difference < best.difference) best = { teamA, teamB, difference }
  }
  if (!best) return { teamA: [], teamB: [] }
  return {
    teamA: shuffle(best.teamA).map((player, index) => ({ ...player, is_backup: index >= teamSize })),
    teamB: shuffle(best.teamB).map((player, index) => ({ ...player, is_backup: index >= teamSize })),
  }
}

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [allProfiles, setAllProfiles] = useState([])
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
  const [teamSize, setTeamSize] = useState(3)
  const [guestName, setGuestName] = useState('')
  const [guestElo, setGuestElo] = useState('1000')

  const [events, setEvents] = useState([])
  const [eventResponses, setEventResponses] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [eventTitle, setEventTitle] = useState('')
  const [eventStartDate, setEventStartDate] = useState('')
  const [eventLocation, setEventLocation] = useState('')
  const [eventDescription, setEventDescription] = useState('')

  const selectedDay = useMemo(
    () => matchDays.find((day) => String(day.id) === String(selectedDayId)) || null,
    [matchDays, selectedDayId]
  )

  const registeredPlayers = useMemo(
    () => registrations.filter((item) => item.status === 'registered').sort((a, b) =>
      String(a.profiles?.display_name || '').localeCompare(String(b.profiles?.display_name || ''), 'de')),
    [registrations]
  )

  const participants = useMemo(() => [
    ...registeredPlayers.map((item) => ({
      key: `player-${item.player_id}`, type: 'player', id: item.player_id,
      display_name: item.profiles?.display_name || 'Spieler', elo: Number(item.profiles?.elo || 1000),
    })),
    ...guests.map((guest) => ({
      key: `guest-${guest.id}`, type: 'guest', id: guest.id,
      display_name: guest.display_name, elo: Number(guest.elo),
    })),
  ], [registeredPlayers, guests])

  const ownRegistration = useMemo(
    () => session ? registrations.find((item) => item.player_id === session.user.id) : null,
    [registrations, session]
  )

  const isRegistered = ownRegistration?.status === 'registered'
  const teamA = teamMembers.filter((member) => member.team === 'A')
  const teamB = teamMembers.filter((member) => member.team === 'B')

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
    if (session) loadInitialData()
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
    const [profileResult, daysResult, profilesResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('match_days').select('*').order('match_date').order('start_time'),
      supabase.from('profiles').select('id, display_name, elo').order('display_name'),
    ])
    const firstError = profileResult.error || daysResult.error || profilesResult.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }
    setProfile(profileResult.data)
    setMatchDays(daysResult.data || [])
    setAllProfiles(profilesResult.data || [])
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const next = (daysResult.data || []).find((day) =>
      new Date(`${day.match_date}T12:00:00`) >= today && day.status !== 'finished') || daysResult.data?.[0]
    if (next && !selectedDayId) setSelectedDayId(next.id)
    await Promise.all([loadRanking(), loadEvents()])
    setLoading(false)
  }

  async function loadDay(dayId) {
    resetFeedback()
    const [registrationsResult, guestsResult, roundsResult] = await Promise.all([
      supabase.from('registrations').select('*, profiles(id, display_name, elo, is_admin)').eq('match_day_id', dayId),
      supabase.from('guest_players').select('*').eq('match_day_id', dayId).order('created_at'),
      supabase.from('rounds').select('*').eq('match_day_id', dayId).order('created_at', { ascending: false }).limit(1),
    ])
    const firstError = registrationsResult.error || guestsResult.error || roundsResult.error
    if (firstError) return setError(firstError.message)
    setRegistrations(registrationsResult.data || [])
    setGuests(guestsResult.data || [])
    const currentRound = roundsResult.data?.[0] || null
    setRound(currentRound)
    if (!currentRound) {
      setTeamMembers([])
      return
    }
    const membersResult = await supabase
      .from('team_members')
      .select('*, profiles(id, display_name, elo), guest_players(id, display_name, elo)')
      .eq('round_id', currentRound.id)
    if (membersResult.error) return setError(membersResult.error.message)
    setTeamMembers((membersResult.data || []).map((member) => ({
      ...member,
      display_name: member.profiles?.display_name || member.guest_players?.display_name || 'Teilnehmer',
      elo: Number(member.elo_before || member.profiles?.elo || member.guest_players?.elo || 1000),
      is_guest: Boolean(member.guest_player_id),
    })))
    setTeamSize(currentRound.team_size)
  }

  async function loadRanking() {
    const [profilesResult, resultsResult] = await Promise.all([
      supabase.from('profiles').select('id, display_name, elo'),
      supabase.from('player_results').select('player_id, result, attendance_points, result_points'),
    ])
    if (profilesResult.error || resultsResult.error) return
    const map = new Map((profilesResult.data || []).map((player) => [player.id, {
      ...player, games: 0, wins: 0, draws: 0, losses: 0, points: 0,
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

  async function loadEvents() {
    const [eventsResult, responsesResult] = await Promise.all([
      supabase.from('events').select('*').order('start_date', { ascending: true }),
      supabase.from('event_responses').select('*'),
    ])
    const firstError = eventsResult.error || responsesResult.error
    if (firstError) return setError(firstError.message)
    setEvents(eventsResult.data || [])
    setEventResponses(responsesResult.data || [])
  }

  async function setEventResponse(eventId, status) {
    setBusy(true); resetFeedback()
    if (status === 'open') {
      const { error: deleteError } = await supabase.from('event_responses').delete()
        .eq('event_id', eventId).eq('player_id', session.user.id)
      if (deleteError) setError(deleteError.message)
      else setMessage('Ihre Auswahl steht wieder auf „Noch offen“.')
    } else {
      const { error: saveError } = await supabase.from('event_responses').upsert({
        event_id: eventId, player_id: session.user.id, status,
      }, { onConflict: 'event_id,player_id' })
      if (saveError) setError(saveError.message)
      else setMessage(status === 'yes' ? 'Sie sind für das Event dabei.' : 'Sie sind für das Event abgemeldet.')
    }
    await loadEvents()
    setBusy(false)
  }

  async function createEvent(event) {
    event.preventDefault(); resetFeedback()
    if (!profile?.is_admin) return
    if (!eventTitle.trim() || !eventStartDate || !eventLocation.trim()) return setError('Bitte Event, Startdatum und Ort ausfüllen.')
    setBusy(true)
    const { error: saveError } = await supabase.from('events').insert({
      title: eventTitle.trim(), start_date: eventStartDate, location: eventLocation.trim(),
      description: eventDescription.trim() || null, created_by: session.user.id,
    })
    if (saveError) setError(saveError.message)
    else {
      setEventTitle(''); setEventStartDate(''); setEventLocation(''); setEventDescription('')
      setMessage('Event wurde angelegt.')
      await loadEvents()
    }
    setBusy(false)
  }

  async function deleteEvent(eventItem) {
    if (!profile?.is_admin) return
    if (!window.confirm(`Event „${eventItem.title}“ wirklich löschen?`)) return
    setBusy(true); resetFeedback()
    const { error: deleteError } = await supabase.from('events').delete().eq('id', eventItem.id)
    if (deleteError) setError(deleteError.message)
    else {
      if (selectedEventId === eventItem.id) setSelectedEventId(null)
      setMessage('Event wurde gelöscht.')
      await loadEvents()
    }
    setBusy(false)
  }

  async function handleLogin(event) {
    event.preventDefault(); resetFeedback()
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (authError) setError(authError.message)
  }

  async function handleRegister(event) {
    event.preventDefault(); resetFeedback()
    if (!displayName.trim()) return setError('Bitte geben Sie einen Anzeigenamen ein.')
    if (password.length < 6) return setError('Das Passwort muss mindestens 6 Zeichen lang sein.')
    if (password !== passwordRepeat) return setError('Die beiden Passwörter stimmen nicht überein.')
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { display_name: displayName.trim() }, emailRedirectTo: window.location.origin },
    })
    if (authError) return setError(authError.message)
    setMessage(data.session ? 'Registrierung erfolgreich.' : 'Registrierung erfolgreich. Bitte bestätigen Sie die E-Mail über den zugesandten Link.')
  }

  async function handleForgotPassword(event) {
    event.preventDefault(); resetFeedback()
    if (!email.trim()) return setError('Bitte geben Sie zuerst Ihre E-Mail-Adresse ein.')
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
    if (authError) return setError(authError.message)
    setMessage('Die E-Mail zum Zurücksetzen des Passworts wurde versendet.')
  }

  async function handleUpdatePassword(event) {
    event.preventDefault(); resetFeedback()
    if (password.length < 6) return setError('Das Passwort muss mindestens 6 Zeichen lang sein.')
    if (password !== passwordRepeat) return setError('Die beiden Passwörter stimmen nicht überein.')
    const { error: authError } = await supabase.auth.updateUser({ password })
    if (authError) return setError(authError.message)
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
    const { error: saveError } = await supabase.from('registrations').upsert({
      match_day_id: selectedDay.id, player_id: session.user.id, status: 'registered',
    }, { onConflict: 'match_day_id,player_id' })
    if (saveError) setError(saveError.message)
    else { setMessage('Sie sind für diesen Spieltag angemeldet.'); await loadDay(selectedDay.id) }
    setBusy(false)
  }

  async function cancelRegistration() {
    setBusy(true); resetFeedback()
    const { error: saveError } = await supabase.from('registrations').update({ status: 'cancelled' })
      .eq('match_day_id', selectedDay.id).eq('player_id', session.user.id)
    if (saveError) setError(saveError.message)
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
    const { error: saveError } = await supabase.from('guest_players').insert({
      match_day_id: selectedDay.id, display_name: name, elo, created_by: session.user.id,
    })
    if (saveError) setError(saveError.message)
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
    const { error: deleteError } = await supabase.from('guest_players').delete().eq('id', guest.id)
    if (deleteError) setError(deleteError.message)
    else { setMessage(`${guest.display_name} wurde entfernt.`); await loadDay(selectedDay.id) }
    setBusy(false)
  }

  async function removePlayer(registration) {
    if (!profile?.is_admin || !window.confirm(`${registration.profiles?.display_name} wirklich vom Spieltag entfernen?`)) return
    setBusy(true); resetFeedback()
    const { error: deleteError } = await supabase.from('registrations').delete().eq('id', registration.id)
    if (deleteError) setError(deleteError.message)
    else { setMessage('Spieler wurde entfernt.'); await loadDay(selectedDay.id) }
    setBusy(false)
  }

  async function createMatchDay(event) {
    event.preventDefault(); resetFeedback()
    if (!newMatchDate) return setError('Bitte ein Datum auswählen.')
    setBusy(true)
    const { data, error: saveError } = await supabase.from('match_days').insert({
      match_date: newMatchDate, start_time: newMatchTime || '19:00', status: 'open',
    }).select().single()
    if (saveError) setError(saveError.message)
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
    const { error: deleteError } = await supabase.from('match_days').delete().eq('id', selectedDay.id)
    if (deleteError) setError(deleteError.message)
    else { setSelectedDayId(null); setMessage('Der Spieltag wurde gelöscht.'); await loadInitialData() }
    setBusy(false)
  }

  async function drawTeams() {
    resetFeedback()
    if (!selectedDay) return setError('Bitte zuerst einen Spieltag auswählen.')
    if (round) return setError('Für diesen Spieltag existiert bereits eine Auslosung.')
    const needed = teamSize * 2
    if (participants.length < needed) return setError(`Für ${teamSize} vs. ${teamSize} werden mindestens ${needed} Teilnehmer benötigt.`)
    setBusy(true)
    const balanced = buildBalancedTeams(participants, teamSize)
    const { data: roundData, error: roundError } = await supabase.from('rounds').insert({
      match_day_id: selectedDay.id, team_size: teamSize, status: 'drawn',
    }).select().single()
    if (roundError) { setError(roundError.message); setBusy(false); return }

    const toRows = (team, teamName) => team.map((player) => ({
      round_id: roundData.id,
      player_id: player.type === 'player' ? player.id : null,
      guest_player_id: player.type === 'guest' ? player.id : null,
      team: teamName, is_backup: player.is_backup, elo_before: player.elo,
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
    await loadDay(selectedDay.id)
    setBusy(false)
  }

  async function deleteDraw() {
    if (!round) return
    if (round.status === 'finished') return setError('Eine bereits gewertete Runde kann nicht gelöscht werden.')
    if (!window.confirm('Auslosung wirklich löschen? Danach kann erneut ausgelost werden.')) return
    setBusy(true); resetFeedback()
    const { error: deleteError } = await supabase.from('rounds').delete().eq('id', round.id)
    if (deleteError) setError(deleteError.message)
    else {
      await supabase.from('match_days').update({ status: 'open' }).eq('id', selectedDay.id)
      setMessage('Auslosung gelöscht. Gäste und Spieler können geändert und Teams neu ausgelost werden.')
      await loadDay(selectedDay.id)
    }
    setBusy(false)
  }

  if (loading) return <main className="center-screen"><p>CO98 wird geladen …</p></main>

  if (mode === 'update-password') return (
    <AuthShell title="Neues Passwort">
      <form onSubmit={handleUpdatePassword}>
        <label>Neues Passwort<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label>Passwort wiederholen<input type="password" value={passwordRepeat} onChange={(event) => setPasswordRepeat(event.target.value)} required /></label>
        <Feedback message={message} error={error} />
        <button className="primary-button">Neues Passwort speichern</button>
      </form>
    </AuthShell>
  )

  if (!session) return (
    <AuthShell title="CO98 Fussi">
      {mode === 'login' && <form onSubmit={handleLogin}>
        <label>E-Mail-Adresse<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Passwort<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <Feedback message={message} error={error} />
        <button className="primary-button">Anmelden</button>
        <button type="button" className="text-button" onClick={() => setMode('forgot-password')}>Passwort vergessen?</button>
        <button type="button" className="secondary-button" onClick={() => setMode('register')}>Neues Konto erstellen</button>
      </form>}
      {mode === 'register' && <form onSubmit={handleRegister}>
        <label>Anzeigename<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
        <label>E-Mail-Adresse<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Passwort<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label>Passwort wiederholen<input type="password" value={passwordRepeat} onChange={(event) => setPasswordRepeat(event.target.value)} required /></label>
        <Feedback message={message} error={error} />
        <button className="primary-button">Registrieren</button>
        <button type="button" className="text-button" onClick={() => setMode('login')}>Zurück zur Anmeldung</button>
      </form>}
      {mode === 'forgot-password' && <form onSubmit={handleForgotPassword}>
        <h2>Passwort zurücksetzen</h2>
        <label>E-Mail-Adresse<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <Feedback message={message} error={error} />
        <button className="primary-button">Reset-Link senden</button>
        <button type="button" className="text-button" onClick={() => setMode('login')}>Zurück zur Anmeldung</button>
      </form>}
    </AuthShell>
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <div><strong>CO98 Fussi</strong><span>Calidad óptica · seit 1998{profile?.is_admin ? ' · Admin' : ''}</span></div>
        <button className="logout-button" onClick={handleLogout}>Abmelden</button>
      </header>

      <main className="app-content">
        <Feedback message={message} error={error} />

        {tab === 'anmelden' && <>
          <section className="content-card">
            <h1>⚽ Anmelden</h1>
            <MatchDaySelect matchDays={matchDays} selectedDayId={selectedDayId} setSelectedDayId={setSelectedDayId} />
            {selectedDay && <div style={{ marginTop: 20, padding: 18, borderRadius: 16, background: '#f5f5f5' }}>
              <strong style={{ display: 'block', fontSize: 20 }}>{formatDate(selectedDay.match_date)}</strong>
              <span>Beginn: {formatTime(selectedDay.start_time)} Uhr</span>
              <div style={{ marginTop: 18 }}>
                {!isRegistered
                  ? <button className="primary-button" disabled={busy} onClick={registerForDay}>✅ Ich bin dabei</button>
                  : <button className="secondary-button" disabled={busy} onClick={cancelRegistration}>Abmelden</button>}
              </div>
            </div>}
          </section>

          {selectedDay && <section className="content-card">
            <h2>Angemeldete Teilnehmer ({participants.length})</h2>
            {participants.length === 0 ? <p>Noch niemand angemeldet.</p> : participants.map((participant, index) => (
              <div key={participant.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 11, borderRadius: 10, background: '#f5f5f5', marginBottom: 8 }}>
                <strong>{index + 1}. {participant.display_name}{participant.type === 'guest' ? ` · Gast · ELO ${participant.elo}` : ''}</strong>
                {participant.type === 'guest'
                  ? <button disabled={busy || Boolean(round)} onClick={() => removeGuest(guests.find((guest) => guest.id === participant.id))}>Gast entfernen</button>
                  : profile?.is_admin
                    ? <button disabled={busy} onClick={() => removePlayer(registeredPlayers.find((item) => item.player_id === participant.id))}>Vom Spieltag entfernen</button>
                    : null}
              </div>
            ))}
          </section>}

          {selectedDay && <section className="content-card">
            <h2>👤 Gastspieler</h2>
            {round ? <p>Zum Ändern der Gäste bitte zuerst die Auslosung löschen.</p> : <form onSubmit={addGuest}>
              <label>Name<input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="z. B. Gast 1 oder Pedro" required /></label>
              <label>Geschätzte ELO<input type="number" min="500" max="2000" value={guestElo} onChange={(event) => setGuestElo(event.target.value)} required /></label>
              <button className="primary-button" disabled={busy}>+ Gastspieler hinzufügen</button>
            </form>}
          </section>}

          {profile?.is_admin && <section className="content-card">
            <h2>⚙️ Admin · Spieltage</h2>
            <form onSubmit={createMatchDay}>
              <label>Datum<input type="date" value={newMatchDate} onChange={(event) => setNewMatchDate(event.target.value)} required /></label>
              <label>Beginn<input type="time" value={newMatchTime} onChange={(event) => setNewMatchTime(event.target.value)} required /></label>
              <button className="primary-button" disabled={busy}>+ Spieltag anlegen</button>
            </form>
            {selectedDay && <button style={{ marginTop: 18, width: '100%' }} disabled={busy} onClick={deleteMatchDay}>Spieltag löschen</button>}
          </section>}
        </>}

        {tab === 'runden' && <>
          <section className="content-card">
            <h1>🎲 Spieltag auslosen</h1>
            <MatchDaySelect matchDays={matchDays} selectedDayId={selectedDayId} setSelectedDayId={setSelectedDayId} label="Spieltag auswählen" />
            {selectedDay && <p><strong>{formatDate(selectedDay.match_date)}</strong> · {participants.length} Teilnehmer</p>}

            {!round && selectedDay && <>
              <h2>Spielformat auswählen</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
                {TEAM_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={teamSize === size}
                    onClick={() => setTeamSize(size)}
                    style={{
                      minHeight: 44,
                      border: teamSize === size ? '1px solid #55e9b3' : '1px solid #36506d',
                      borderRadius: 999,
                      background: teamSize === size ? '#55e9b3' : '#203754',
                      color: teamSize === size ? '#052017' : '#ffffff',
                      fontWeight: 900,
                      boxShadow: teamSize === size ? '0 0 0 3px rgba(85, 233, 179, 0.15)' : 'none',
                    }}
                  >
                    {size} vs. {size}
                  </button>
                ))}
              </div>
              <button className="primary-button" disabled={busy} onClick={drawTeams}>🎲 Mannschaften auslosen</button>
            </>}
          </section>

          {round && <>
            <TeamCard title="⚫ Team A" members={teamA} />
            <TeamCard title="⚪ Team B" members={teamB} />
            <section className="content-card">
              <button disabled={busy} onClick={deleteDraw}>🗑️ Auslosung löschen</button>
            </section>
          </>}
        </>}

        {tab === 'ranking' && <section className="content-card">
          <h1>🏆 Ranking</h1>
          <p>Gastspieler werden hier bewusst nicht geführt.</p>
          <div style={{ overflowX: 'auto' }}><table><thead><tr><th>#</th><th>Spieler</th><th>Sp.</th><th>S</th><th>U</th><th>N</th><th>Punkte</th><th>ELO</th></tr></thead><tbody>
            {ranking.map((player, index) => <tr key={player.id}><td>{index + 1}.</td><td>{player.display_name}</td><td>{player.games}</td><td>{player.wins}</td><td>{player.draws}</td><td>{player.losses}</td><td>{player.points}</td><td>{player.elo}</td></tr>)}
          </tbody></table></div>
        </section>}

        {tab === 'events' && <>
          <section className="content-card">
            <h1>🎉 Events</h1>
            <p>Kommende Veranstaltungen, nach Startdatum sortiert.</p>
            {events.length === 0 ? <p>Noch keine Events angelegt.</p> : events.map((eventItem) => (
              <EventCard
                key={eventItem.id}
                eventItem={eventItem}
                profiles={allProfiles}
                responses={eventResponses.filter((response) => response.event_id === eventItem.id)}
                currentUserId={session.user.id}
                expanded={selectedEventId === eventItem.id}
                busy={busy}
                isAdmin={Boolean(profile?.is_admin)}
                onToggle={() => setSelectedEventId(selectedEventId === eventItem.id ? null : eventItem.id)}
                onResponse={(status) => setEventResponse(eventItem.id, status)}
                onDelete={() => deleteEvent(eventItem)}
              />
            ))}
          </section>

          {profile?.is_admin && <section className="content-card">
            <h2>⚙️ Admin · Event anlegen</h2>
            <form onSubmit={createEvent}>
              <label>Event<input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="z. B. Weihnachtsfeier" required /></label>
              <label>Startdatum<input type="date" value={eventStartDate} onChange={(event) => setEventStartDate(event.target.value)} required /></label>
              <label>Ort<input value={eventLocation} onChange={(event) => setEventLocation(event.target.value)} placeholder="z. B. Brauhaus Hannover" required /></label>
              <label>Beschreibung / Freitext<textarea value={eventDescription} onChange={(event) => setEventDescription(event.target.value)} rows="4" placeholder="Weitere Informationen zum Event" /></label>
              <button className="primary-button" disabled={busy}>+ Event anlegen</button>
            </form>
          </section>}
        </>}
      </main>

      <nav className="bottom-navigation">
        <button className={tab === 'anmelden' ? 'active' : ''} onClick={() => setTab('anmelden')}>⚽ <span>Anmelden</span></button>
        <button className={tab === 'runden' ? 'active' : ''} onClick={() => setTab('runden')}>🎲 <span>Spieltag auslosen</span></button>
        <button className={tab === 'ranking' ? 'active' : ''} onClick={() => { setTab('ranking'); loadRanking() }}>🏆 <span>Ranking</span></button>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => { setTab('events'); loadEvents() }}>🎉 <span>Events</span></button>
      </nav>
    </div>
  )
}

function EventCard({ eventItem, profiles, responses, currentUserId, expanded, busy, isAdmin, onToggle, onResponse, onDelete }) {
  const yesIds = new Set(responses.filter((response) => response.status === 'yes').map((response) => response.player_id))
  const noIds = new Set(responses.filter((response) => response.status === 'no').map((response) => response.player_id))
  const yesPlayers = profiles.filter((player) => yesIds.has(player.id))
  const noPlayers = profiles.filter((player) => noIds.has(player.id))
  const openPlayers = profiles.filter((player) => !yesIds.has(player.id) && !noIds.has(player.id))
  const own = responses.find((response) => response.player_id === currentUserId)
  const ownStatus = own?.status || 'open'

  return <div style={{ marginTop: 14, padding: 16, borderRadius: 16, background: '#081728', border: '1px solid #263c54' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 18 }}>{eventItem.title}</strong>
        <span>{formatDate(eventItem.start_date)} · Ort: {eventItem.location}</span>
      </div>
      <button
        type="button"
        className="primary-button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ flex: '0 0 auto', minWidth: 92 }}
      >
        {expanded ? 'Schließen' : 'Klick'}
      </button>
    </div>
    <p>✅ Dabei ({yesPlayers.length}) · ❌ Nicht dabei ({noPlayers.length}) · ❓ Offen ({openPlayers.length})</p>

    {expanded && <div>
      {eventItem.description && <p>{eventItem.description}</p>}
      <h3>Meine Teilnahme</h3>
      <p>Aktuell: {RESPONSE_LABELS[ownStatus]}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button type="button" className={ownStatus === 'yes' ? 'primary-button' : 'secondary-button'} disabled={busy} onClick={() => onResponse('yes')}>✅ Ich bin dabei</button>
        <button type="button" className={ownStatus === 'no' ? 'primary-button' : 'secondary-button'} disabled={busy} onClick={() => onResponse('no')}>❌ Ich bin nicht dabei</button>
        <button type="button" className={ownStatus === 'open' ? 'primary-button' : 'secondary-button'} disabled={busy} onClick={() => onResponse('open')}>❓ Noch offen</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
        <PeopleGroup title={`Dabei (${yesPlayers.length})`} players={yesPlayers} />
        <PeopleGroup title={`Nicht dabei (${noPlayers.length})`} players={noPlayers} />
        <PeopleGroup title={`Noch offen (${openPlayers.length})`} players={openPlayers} />
      </div>

      {isAdmin && <button type="button" disabled={busy} onClick={onDelete} style={{ marginTop: 16 }}>🗑️ Event löschen</button>}
    </div>}
  </div>
}

function PeopleGroup({ title, players }) {
  return <div style={{ padding: 12, borderRadius: 12, background: '#102034', border: '1px solid #263c54' }}>
    <h3>{title}</h3>
    {players.length === 0 ? <p>–</p> : players.map((player) => <div key={player.id}>{player.display_name}</div>)}
  </div>
}

function MatchDaySelect({ matchDays, selectedDayId, setSelectedDayId, label = 'Spieltag' }) {
  if (!matchDays.length) return <p>Noch kein Spieltag angelegt.</p>
  return <label>{label}<select value={selectedDayId || ''} onChange={(event) => setSelectedDayId(Number(event.target.value))}>
    {matchDays.map((day) => <option key={day.id} value={day.id}>{formatDate(day.match_date)} · {formatTime(day.start_time)} Uhr</option>)}
  </select></label>
}

function TeamCard({ title, members }) {
  return <section className="content-card"><h2>{title}</h2><p>Ø ELO: {averageElo(members)}</p>
    {members.map((member, index) => <div key={member.id} style={{ padding: '9px 0', borderBottom: '1px solid #263c54' }}>
      <strong>{index + 1}. {member.display_name}</strong>{member.is_guest && <span> · Gast · ELO {member.elo}</span>}{member.is_backup && <span> · Backup</span>}
    </div>)}
  </section>
}

function AuthShell({ title, children }) {
  return <main className="center-screen"><section className="auth-card">
    <div className="brand"><div className="brand-mark">CO98</div><h1>{title}</h1><p>Calidad óptica · seit 1998</p></div>
    {children}
  </section></main>
}

function Feedback({ message, error }) {
  return <>{message && <p className="message success">{message}</p>}{error && <p className="message error">{error}</p>}</>
}
