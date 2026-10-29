import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const TEAM_SIZES = [3, 4, 5, 6]

function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

function formatTime(value) {
  if (!value) return ''
  return String(value).slice(0, 5)
}

function shuffle(array) {
  const copy = [...array]

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }

  return copy
}

function averageElo(players) {
  if (!players.length) return 0

  return Math.round(
    players.reduce((sum, player) => sum + Number(player.elo || 1000), 0) /
      players.length
  )
}

function combinations(items, size) {
  const result = []

  function build(start, combination) {
    if (combination.length === size) {
      result.push(combination)
      return
    }

    for (let i = start; i < items.length; i += 1) {
      combination.push(items[i])
      build(i + 1, combination)
      combination.pop()
    }
  }

  build(0, [])
  return result
}

function buildBalancedTeams(players, teamSize) {
  const randomized = shuffle(players)

  const teamACount = Math.floor(randomized.length / 2)

  let candidates = combinations(randomized, teamACount)

  // Sicherheitsgrenze für sehr große Teilnehmerfelder.
  if (candidates.length > 100000) {
    candidates = candidates
      .sort(() => Math.random() - 0.5)
      .slice(0, 100000)
  }

  let best = null

  for (const teamA of candidates) {
    const teamAIds = new Set(teamA.map((player) => player.id))
    const teamB = randomized.filter((player) => !teamAIds.has(player.id))

    const difference = Math.abs(
      averageElo(teamA) - averageElo(teamB)
    )

    if (!best || difference < best.difference) {
      best = {
        teamA,
        teamB,
        difference,
      }
    }
  }

  if (!best) {
    return {
      teamA: [],
      teamB: [],
    }
  }

  // Innerhalb der beiden ausgeglichenen Kader wird zufällig festgelegt,
  // wer zunächst auf dem Platz steht und wer Backup ist.
  // Backup-Spieler bleiben vollwertige Mitglieder ihres Teams.
  best.teamA = shuffle(best.teamA)
  best.teamB = shuffle(best.teamB)

  return {
    teamA: best.teamA.map((player, index) => ({
      ...player,
      is_backup: index >= teamSize,
    })),
    teamB: best.teamB.map((player, index) => ({
      ...player,
      is_backup: index >= teamSize,
    })),
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
  const [round, setRound] = useState(null)
  const [teamMembers, setTeamMembers] = useState([])
  const [ranking, setRanking] = useState([])

  const [newMatchDate, setNewMatchDate] = useState('')
  const [newMatchTime, setNewMatchTime] = useState('19:00')
  const [teamSize, setTeamSize] = useState(4)

  const [goalsA, setGoalsA] = useState('')
  const [goalsB, setGoalsB] = useState('')

  const selectedDay = useMemo(
    () =>
      matchDays.find(
        (day) => String(day.id) === String(selectedDayId)
      ) || null,
    [matchDays, selectedDayId]
  )

  const registeredPlayers = useMemo(
    () =>
      registrations
        .filter((registration) => registration.status === 'registered')
        .sort((a, b) =>
          String(a.profiles?.display_name || '').localeCompare(
            String(b.profiles?.display_name || ''),
            'de'
          )
        ),
    [registrations]
  )

  const ownRegistration = useMemo(
    () =>
      session
        ? registrations.find(
            (registration) =>
              registration.player_id === session.user.id
          )
        : null,
    [registrations, session]
  )

  const isRegistered =
    ownRegistration?.status === 'registered'

  const teamA = teamMembers.filter(
    (member) => member.team === 'A'
  )

  const teamB = teamMembers.filter(
    (member) => member.team === 'B'
  )

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return

      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)

      if (event === 'PASSWORD_RECOVERY') {
        setMode('update-password')
        setMessage(
          'Bitte legen Sie jetzt ein neues Passwort fest.'
        )
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setMatchDays([])
      setSelectedDayId(null)
      setRegistrations([])
      setRound(null)
      setTeamMembers([])
      setRanking([])
      return
    }

    loadInitialData()
  }, [session])

  useEffect(() => {
    if (!session || !selectedDayId) return
    loadDay(selectedDayId)
  }, [session, selectedDayId])

  function resetFeedback() {
    setMessage('')
    setError('')
  }

  async function loadInitialData() {
    setLoading(true)
    resetFeedback()

    try {
      const [
        { data: profileData, error: profileError },
        { data: daysData, error: daysError },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single(),

        supabase
          .from('match_days')
          .select('*')
          .order('match_date', { ascending: true })
          .order('start_time', { ascending: true }),
      ])

      if (profileError) throw profileError
      if (daysError) throw daysError

      setProfile(profileData)
      setMatchDays(daysData || [])

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const upcoming =
        (daysData || []).find((day) => {
          const date = new Date(`${day.match_date}T12:00:00`)
          return date >= today && day.status !== 'finished'
        }) ||
        (daysData || [])[0]

      if (upcoming) {
        setSelectedDayId(upcoming.id)
      }

      await loadRanking()
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadDay(dayId) {
    resetFeedback()

    try {
      const [
        { data: registrationData, error: registrationError },
        { data: roundsData, error: roundsError },
      ] = await Promise.all([
        supabase
          .from('registrations')
          .select('*, profiles(id, display_name, elo, is_admin)')
          .eq('match_day_id', dayId),

        supabase
          .from('rounds')
          .select('*')
          .eq('match_day_id', dayId)
          .order('created_at', { ascending: false })
          .limit(1),
      ])

      if (registrationError) throw registrationError
      if (roundsError) throw roundsError

      setRegistrations(registrationData || [])

      const currentRound = roundsData?.[0] || null
      setRound(currentRound)

      if (currentRound) {
        const { data: membersData, error: membersError } =
          await supabase
            .from('team_members')
            .select(
              '*, profiles(id, display_name, elo, is_admin)'
            )
            .eq('round_id', currentRound.id)

        if (membersError) throw membersError

        setTeamMembers(membersData || [])
        setTeamSize(currentRound.team_size)
        setGoalsA(
          currentRound.goals_a === null
            ? ''
            : String(currentRound.goals_a)
        )
        setGoalsB(
          currentRound.goals_b === null
            ? ''
            : String(currentRound.goals_b)
        )
      } else {
        setTeamMembers([])
        setGoalsA('')
        setGoalsB('')
      }
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  async function loadRanking() {
    const [
      { data: profilesData, error: profilesError },
      { data: resultsData, error: resultsError },
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, elo'),

      supabase
        .from('player_results')
        .select('player_id, result, attendance_points, result_points'),
    ])

    if (profilesError) {
      setError(profilesError.message)
      return
    }

    if (resultsError) {
      setError(resultsError.message)
      return
    }

    const map = new Map()

    for (const player of profilesData || []) {
      map.set(player.id, {
        id: player.id,
        display_name: player.display_name,
        elo: player.elo,
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        attendance: 0,
        resultPoints: 0,
        points: 0,
      })
    }

    for (const result of resultsData || []) {
      const player = map.get(result.player_id)
      if (!player) continue

      player.games += 1
      player.attendance += Number(
        result.attendance_points || 0
      )

      player.resultPoints += Number(
        result.result_points || 0
      )

      if (result.result === 'win') player.wins += 1
      if (result.result === 'draw') player.draws += 1
      if (result.result === 'loss') player.losses += 1

      player.points =
        player.attendance + player.resultPoints
    }

    setRanking(
      [...map.values()].sort(
        (a, b) =>
          b.points - a.points ||
          b.wins - a.wins ||
          b.elo - a.elo ||
          a.display_name.localeCompare(
            b.display_name,
            'de'
          )
      )
    )
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
      setError(
        'Das Passwort muss mindestens 6 Zeichen lang sein.'
      )
      return
    }

    if (password !== passwordRepeat) {
      setError(
        'Die beiden Passwörter stimmen nicht überein.'
      )
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
      setError(
        'Bitte geben Sie zuerst Ihre E-Mail-Adresse ein.'
      )
      return
    }

    const { error: resetError } =
      await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: window.location.origin,
        }
      )

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
      setError(
        'Das Passwort muss mindestens 6 Zeichen lang sein.'
      )
      return
    }

    if (password !== passwordRepeat) {
      setError(
        'Die beiden Passwörter stimmen nicht überein.'
      )
      return
    }

    const { error: updateError } =
      await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      return
    }

    setPassword('')
    setPasswordRepeat('')
    setMode('login')

    setMessage(
      'Das neue Passwort wurde erfolgreich gespeichert.'
    )
  }

  async function handleLogout() {
    resetFeedback()

    await supabase.auth.signOut()

    setMode('login')
    setEmail('')
    setPassword('')
    setPasswordRepeat('')
  }

  async function registerForDay() {
    if (!session || !selectedDay) return

    setBusy(true)
    resetFeedback()

    const { error: registrationError } =
      await supabase
        .from('registrations')
        .upsert(
          {
            match_day_id: selectedDay.id,
            player_id: session.user.id,
            status: 'registered',
          },
          {
            onConflict: 'match_day_id,player_id',
          }
        )

    if (registrationError) {
      setError(registrationError.message)
    } else {
      setMessage(
        'Sie sind für diesen Spieltag angemeldet.'
      )
      await loadDay(selectedDay.id)
    }

    setBusy(false)
  }

  async function cancelRegistration() {
    if (!session || !selectedDay) return

    setBusy(true)
    resetFeedback()

    const { error: cancellationError } =
      await supabase
        .from('registrations')
        .update({ status: 'cancelled' })
        .eq('match_day_id', selectedDay.id)
        .eq('player_id', session.user.id)

    if (cancellationError) {
      setError(cancellationError.message)
    } else {
      setMessage(
        'Sie sind für diesen Spieltag abgemeldet.'
      )
      await loadDay(selectedDay.id)
    }

    setBusy(false)
  }

  async function removePlayer(registration) {
    if (!profile?.is_admin || !selectedDay) return

    const name =
      registration.profiles?.display_name || 'Spieler'

    const confirmed = window.confirm(
      `${name} wirklich vom Spieltag entfernen?\n\nDer Spieler kann sich später jederzeit wieder selbst anmelden.`
    )

    if (!confirmed) return

    setBusy(true)
    resetFeedback()

    const { error: removeError } =
      await supabase
        .from('registrations')
        .delete()
        .eq('id', registration.id)

    if (removeError) {
      setError(removeError.message)
    } else {
      setMessage(
        `${name} wurde vom Spieltag entfernt.`
      )
      await loadDay(selectedDay.id)
    }

    setBusy(false)
  }

  async function createMatchDay(event) {
    event.preventDefault()

    if (!profile?.is_admin) return

    if (!newMatchDate) {
      setError('Bitte wählen Sie ein Datum.')
      return
    }

    setBusy(true)
    resetFeedback()

    const { data, error: createError } =
      await supabase
        .from('match_days')
        .insert({
          match_date: newMatchDate,
          start_time: newMatchTime || '19:00',
          status: 'open',
        })
        .select()
        .single()

    if (createError) {
      setError(createError.message)
      setBusy(false)
      return
    }

    setNewMatchDate('')
    setNewMatchTime('19:00')

    await loadInitialData()
    setSelectedDayId(data.id)

    setMessage('Der neue Spieltag wurde angelegt.')
    setBusy(false)
  }

  async function deleteMatchDay() {
    if (!profile?.is_admin || !selectedDay) return

    const confirmed = window.confirm(
      `${formatDate(
        selectedDay.match_date
      )} wirklich komplett löschen?\n\nAnmeldungen und eventuell vorhandene Auslosungen dieses Spieltags werden ebenfalls gelöscht.`
    )

    if (!confirmed) return

    setBusy(true)
    resetFeedback()

    const { error: deleteError } =
      await supabase
        .from('match_days')
        .delete()
        .eq('id', selectedDay.id)

    if (deleteError) {
      setError(deleteError.message)
    } else {
      setSelectedDayId(null)
      setRegistrations([])
      setRound(null)
      setTeamMembers([])
      setMessage('Der Spieltag wurde gelöscht.')
      await loadInitialData()
    }

    setBusy(false)
  }

  async function drawTeams() {
    if (!profile?.is_admin || !selectedDay) return

    resetFeedback()

    if (round) {
      setError(
        'Für diesen Spieltag existiert bereits eine Auslosung. Löschen Sie diese zuerst, wenn neu ausgelost werden soll.'
      )
      return
    }

    const needed = teamSize * 2

    if (registeredPlayers.length < needed) {
      setError(
        `Für ${teamSize} vs. ${teamSize} werden mindestens ${needed} angemeldete Spieler benötigt. Aktuell sind ${registeredPlayers.length} angemeldet.`
      )
      return
    }

    setBusy(true)

    const players = registeredPlayers.map(
      (registration) => ({
        id: registration.player_id,
        display_name:
          registration.profiles?.display_name ||
          'Spieler',
        elo: Number(registration.profiles?.elo || 1000),
      })
    )

    const balanced = buildBalancedTeams(
      players,
      teamSize
    )

    const { data: roundData, error: roundError } =
      await supabase
        .from('rounds')
        .insert({
          match_day_id: selectedDay.id,
          team_size: teamSize,
          status: 'drawn',
        })
        .select()
        .single()

    if (roundError) {
      setError(roundError.message)
      setBusy(false)
      return
    }

    const members = [
      ...balanced.teamA.map((player) => ({
        round_id: roundData.id,
        player_id: player.id,
        team: 'A',
        is_backup: player.is_backup,
        elo_before: player.elo,
      })),
      ...balanced.teamB.map((player) => ({
        round_id: roundData.id,
        player_id: player.id,
        team: 'B',
        is_backup: player.is_backup,
        elo_before: player.elo,
      })),
    ]

    const { error: membersError } =
      await supabase
        .from('team_members')
        .insert(members)

    if (membersError) {
      await supabase
        .from('rounds')
        .delete()
        .eq('id', roundData.id)

      setError(membersError.message)
      setBusy(false)
      return
    }

    await supabase
      .from('match_days')
      .update({ status: 'drawn' })
      .eq('id', selectedDay.id)

    setMessage(
      `${teamSize} vs. ${teamSize} wurde möglichst ELO-ausgeglichen ausgelost.`
    )

    await loadInitialData()
    setSelectedDayId(selectedDay.id)
    await loadDay(selectedDay.id)

    setBusy(false)
  }

  async function deleteDraw() {
    if (!profile?.is_admin || !round || !selectedDay)
      return

    if (round.status === 'finished') {
      setError(
        'Ein bereits abgeschlossenes und gewertetes Spiel kann hier nicht gelöscht werden.'
      )
      return
    }

    const confirmed = window.confirm(
      'Auslosung wirklich löschen?\n\nDanach können weitere Spieler angemeldet werden und Sie können erneut auslosen.'
    )

    if (!confirmed) return

    setBusy(true)
    resetFeedback()

    const { error: deleteError } =
      await supabase
        .from('rounds')
        .delete()
        .eq('id', round.id)

    if (deleteError) {
      setError(deleteError.message)
      setBusy(false)
      return
    }

    const { error: statusError } =
      await supabase
        .from('match_days')
        .update({ status: 'open' })
        .eq('id', selectedDay.id)

    if (statusError) {
      setError(statusError.message)
      setBusy(false)
      return
    }

    setMessage(
      'Die Auslosung wurde gelöscht. Weitere Spieler können sich jetzt anmelden und anschließend kann neu ausgelost werden.'
    )

    setRound(null)
    setTeamMembers([])

    await loadInitialData()
    setSelectedDayId(selectedDay.id)
    await loadDay(selectedDay.id)

    setBusy(false)
  }

  if (loading) {
    return (
      <main className="center-screen">
        <p style={{ color: '#fff' }}>
          CO98 wird geladen …
        </p>
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
                onChange={(event) =>
                  setPassword(event.target.value)
                }
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

            {message && (
              <p className="message success">
                {message}
              </p>
            )}

            {error && (
              <p className="message error">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="primary-button"
            >
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

            <p>
              Calidad óptica · seit 1998
            </p>
          </div>

          {mode === 'login' && (
            <form onSubmit={handleLogin}>
              <label>
                E-Mail-Adresse
                <input
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                Passwort
                <input
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  autoComplete="current-password"
                  required
                />
              </label>

              {message && (
                <p className="message success">
                  {message}
                </p>
              )}

              {error && (
                <p className="message error">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="primary-button"
              >
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
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                Passwort
                <input
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
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

              {message && (
                <p className="message success">
                  {message}
                </p>
              )}

              {error && (
                <p className="message error">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="primary-button"
              >
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
                Geben Sie die E-Mail-Adresse des Kontos
                ein.
              </p>

              <label>
                E-Mail-Adresse
                <input
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  autoComplete="email"
                  required
                />
              </label>

              {message && (
                <p className="message success">
                  {message}
                </p>
              )}

              {error && (
                <p className="message error">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="primary-button"
              >
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

          <span>
            Calidad óptica · seit 1998
            {profile?.is_admin ? ' · Admin' : ''}
          </span>
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
        {message && (
          <p className="message success">
            {message}
          </p>
        )}

        {error && (
          <p className="message error">
            {error}
          </p>
        )}

        {tab === 'anmelden' && (
          <>
            <section className="content-card">
              <h1>⚽ Anmelden</h1>

              {matchDays.length === 0 ? (
                <p>
                  Aktuell ist noch kein Spieltag
                  angelegt.
                </p>
              ) : (
                <>
                  <label>
                    Spieltag
                    <select
                      value={selectedDayId || ''}
                      onChange={(event) =>
                        setSelectedDayId(
                          Number(event.target.value)
                        )
                      }
                      style={{
                        width: '100%',
                        padding: '13px',
                        borderRadius: '12px',
                        border: '1px solid #ccc',
                        fontSize: '16px',
                        background: '#fff',
                      }}
                    >
                      {matchDays.map((day) => (
                        <option
                          key={day.id}
                          value={day.id}
                        >
                          {formatDate(day.match_date)} ·{' '}
                          {formatTime(day.start_time)} Uhr
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedDay && (
                    <div
                      style={{
                        marginTop: '20px',
                        padding: '18px',
                        borderRadius: '16px',
                        background: '#f5f5f5',
                      }}
                    >
                      <strong
                        style={{
                          display: 'block',
                          fontSize: '20px',
                        }}
                      >
                        {formatDate(
                          selectedDay.match_date
                        )}
                      </strong>

                      <span>
                        Beginn:{' '}
                        {formatTime(
                          selectedDay.start_time
                        )}{' '}
                        Uhr
                      </span>

                      <div
                        style={{
                          marginTop: '18px',
                          display: 'flex',
                          gap: '10px',
                          flexWrap: 'wrap',
                        }}
                      >
                        {!isRegistered ? (
                          <button
                            type="button"
                            className="primary-button"
                            disabled={busy}
                            onClick={registerForDay}
                            style={{
                              padding: '0 20px',
                            }}
                          >
                            ✅ Ich bin dabei
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={cancelRegistration}
                            style={{
                              padding: '0 20px',
                            }}
                          >
                            Abmelden
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            {selectedDay && (
              <section
                className="content-card"
                style={{ marginTop: '18px' }}
              >
                <h2 style={{ marginTop: 0 }}>
                  Angemeldete Spieler (
                  {registeredPlayers.length})
                </h2>

                {registeredPlayers.length === 0 ? (
                  <p>
                    Noch niemand angemeldet.
                  </p>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    {registeredPlayers.map(
                      (registration, index) => (
                        <div
                          key={registration.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent:
                              'space-between',
                            gap: '12px',
                            padding: '11px 12px',
                            background: '#f5f5f5',
                            borderRadius: '10px',
                          }}
                        >
                          <strong>
                            {index + 1}.{' '}
                            {
                              registration.profiles
                                ?.display_name
                            }
                          </strong>

                          {profile?.is_admin && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                removePlayer(
                                  registration
                                )
                              }
                              style={{
                                border: 0,
                                background: '#981b1b',
                                color: '#fff',
                                padding: '8px 10px',
                                borderRadius: '9px',
                                fontWeight: 700,
                              }}
                            >
                              Vom Spieltag entfernen
                            </button>
                          )}
                        </div>
                      )
                    )}
                  </div>
                )}
              </section>
            )}

            {profile?.is_admin && (
              <section
                className="content-card"
                style={{ marginTop: '18px' }}
              >
                <h2 style={{ marginTop: 0 }}>
                  ⚙️ Admin · Spieltage
                </h2>

                <form
                  onSubmit={createMatchDay}
                  style={{ marginBottom: '18px' }}
                >
                  <label>
                    Datum
                    <input
                      type="date"
                      value={newMatchDate}
                      onChange={(event) =>
                        setNewMatchDate(
                          event.target.value
                        )
                      }
                      required
                    />
                  </label>

                  <label>
                    Beginn
                    <input
                      type="time"
                      value={newMatchTime}
                      onChange={(event) =>
                        setNewMatchTime(
                          event.target.value
                        )
                      }
                      required
                    />
                  </label>

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={busy}
                  >
                    + Spieltag anlegen
                  </button>
                </form>

                {selectedDay && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={deleteMatchDay}
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      border: 0,
                      borderRadius: '12px',
                      background: '#981b1b',
                      color: '#fff',
                      fontWeight: 800,
                    }}
                  >
                    Spieltag löschen
                  </button>
                )}
              </section>
            )}
          </>
        )}

        {tab === 'runden' && (
          <>
            <section className="content-card">
              <h1>🎲 Runden</h1>

              {!selectedDay ? (
                <p>
                  Bitte zuerst einen Spieltag
                  auswählen.
                </p>
              ) : (
                <>
                  <p>
                    <strong>
                      {formatDate(
                        selectedDay.match_date
                      )}
                    </strong>{' '}
                    ·{' '}
                    {registeredPlayers.length}{' '}
                    Spieler angemeldet
                  </p>

                  {!round &&
                    profile?.is_admin && (
                      <>
                        <h2>Spielformat</h2>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns:
                              'repeat(2, 1fr)',
                            gap: '10px',
                            marginBottom: '18px',
                          }}
                        >
                          {TEAM_SIZES.map(
                            (size) => (
                              <button
                                key={size}
                                type="button"
                                onClick={() =>
                                  setTeamSize(size)
                                }
                                style={{
                                  minHeight: '50px',
                                  borderRadius:
                                    '12px',
                                  border:
                                    teamSize ===
                                    size
                                      ? '3px solid #111'
                                      : '1px solid #ccc',
                                  background:
                                    teamSize ===
                                    size
                                      ? '#111'
                                      : '#fff',
                                  color:
                                    teamSize ===
                                    size
                                      ? '#fff'
                                      : '#111',
                                  fontWeight: 900,
                                }}
                              >
                                {size} vs. {size}
                              </button>
                            )
                          )}
                        </div>

                        <button
                          type="button"
                          className="primary-button"
                          disabled={busy}
                          onClick={drawTeams}
                          style={{
                            width: '100%',
                          }}
                        >
                          🎲 Mannschaften
                          auslosen
                        </button>
                      </>
                    )}

                  {!round &&
                    !profile?.is_admin && (
                      <p>
                        Noch keine Mannschaften
                        ausgelost.
                      </p>
                    )}
                </>
              )}
            </section>

            {round && (
              <>
                <section
                  className="content-card"
                  style={{ marginTop: '18px' }}
                >
                  <h2 style={{ marginTop: 0 }}>
                    ⚫ Team A
                  </h2>

                  <p>
                    Ø ELO:{' '}
                    {averageElo(
                      teamA.map((member) => ({
                        elo:
                          member.elo_before ??
                          member.profiles?.elo,
                      }))
                    )}
                  </p>

                  {teamA.map((member, index) => (
                    <div
                      key={member.id}
                      style={{
                        padding: '9px 0',
                        borderBottom:
                          '1px solid #eee',
                      }}
                    >
                      <strong>
                        {index + 1}.{' '}
                        {
                          member.profiles
                            ?.display_name
                        }
                      </strong>
                      {member.is_backup && (
                        <span>
                          {' '}
                          · Backup
                        </span>
                      )}
                    </div>
                  ))}
                </section>

                <section
                  className="content-card"
                  style={{ marginTop: '18px' }}
                >
                  <h2 style={{ marginTop: 0 }}>
                    ⚪ Team B
                  </h2>

                  <p>
                    Ø ELO:{' '}
                    {averageElo(
                      teamB.map((member) => ({
                        elo:
                          member.elo_before ??
                          member.profiles?.elo,
                      }))
                    )}
                  </p>

                  {teamB.map((member, index) => (
                    <div
                      key={member.id}
                      style={{
                        padding: '9px 0',
                        borderBottom:
                          '1px solid #eee',
                      }}
                    >
                      <strong>
                        {index + 1}.{' '}
                        {
                          member.profiles
                            ?.display_name
                        }
                      </strong>
                      {member.is_backup && (
                        <span>
                          {' '}
                          · Backup
                        </span>
                      )}
                    </div>
                  ))}
                </section>

                {profile?.is_admin &&
                  round.status !== 'finished' && (
                    <section
                      className="content-card"
                      style={{
                        marginTop: '18px',
                      }}
                    >
                      <h2 style={{ marginTop: 0 }}>
                        Admin
                      </h2>

                      <p>
                        Falls noch ein Spieler
                        später kommt, können Sie
                        die Auslosung löschen. Der
                        Spieler meldet sich
                        anschließend an und danach
                        wird neu ausgelost.
                      </p>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={deleteDraw}
                        style={{
                          width: '100%',
                          minHeight: '46px',
                          border: 0,
                          borderRadius: '12px',
                          background: '#981b1b',
                          color: '#fff',
                          fontWeight: 900,
                        }}
                      >
                        🗑️ Auslosung löschen
                      </button>
                    </section>
                  )}
              </>
            )}
          </>
        )}

        {tab === 'ranking' && (
          <section className="content-card">
            <h1>🏆 Ranking</h1>

            <p
              style={{
                marginBottom: '18px',
              }}
            >
              1 Punkt für Anwesenheit · 3 Punkte
              für Sieg · 1 Punkt für
              Unentschieden
            </p>

            {ranking.length === 0 ? (
              <p>
                Noch keine Spieler vorhanden.
              </p>
            ) : (
              <div
                style={{
                  overflowX: 'auto',
                }}
              >
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    minWidth: '650px',
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '10px',
                        }}
                      >
                        #
                      </th>

                      <th
                        style={{
                          textAlign: 'left',
                          padding: '10px',
                        }}
                      >
                        Spieler
                      </th>

                      <th>Sp.</th>
                      <th>S</th>
                      <th>U</th>
                      <th>N</th>
                      <th>Punkte</th>
                      <th>ELO</th>
                    </tr>
                  </thead>

                  <tbody>
                    {ranking.map(
                      (player, index) => (
                        <tr
                          key={player.id}
                          style={{
                            borderTop:
                              '1px solid #ddd',
                          }}
                        >
                          <td
                            style={{
                              padding: '10px',
                            }}
                          >
                            {index + 1}.
                          </td>

                          <td
                            style={{
                              padding: '10px',
                              fontWeight: 800,
                            }}
                          >
                            {
                              player.display_name
                            }
                          </td>

                          <td
                            style={{
                              textAlign:
                                'center',
                            }}
                          >
                            {player.games}
                          </td>

                          <td
                            style={{
                              textAlign:
                                'center',
                            }}
                          >
                            {player.wins}
                          </td>

                          <td
                            style={{
                              textAlign:
                                'center',
                            }}
                          >
                            {player.draws}
                          </td>

                          <td
                            style={{
                              textAlign:
                                'center',
                            }}
                          >
                            {player.losses}
                          </td>

                          <td
                            style={{
                              textAlign:
                                'center',
                              fontWeight: 900,
                            }}
                          >
                            {player.points}
                          </td>

                          <td
                            style={{
                              textAlign:
                                'center',
                            }}
                          >
                            {player.elo}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      <nav className="bottom-navigation">
        <button
          type="button"
          className={
            tab === 'anmelden'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab('anmelden')
          }
        >
          ⚽
          <span>Anmelden</span>
        </button>

        <button
          type="button"
          className={
            tab === 'runden'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab('runden')
          }
        >
          🎲
          <span>Runden</span>
        </button>

        <button
          type="button"
          className={
            tab === 'ranking'
              ? 'active'
              : ''
          }
          onClick={() => {
            setTab('ranking')
            loadRanking()
          }}
        >
          🏆
          <span>Ranking</span>
        </button>
      </nav>
    </div>
  )
}
