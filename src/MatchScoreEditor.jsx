import React from 'react';
import { Save } from 'lucide-react';

const setRows = [
  ['Satz 1', 'set1_team_a', 'set1_team_b'],
  ['Satz 2', 'set2_team_a', 'set2_team_b'],
  ['Satz 3', 'set3_team_a', 'set3_team_b'],
];

export default function MatchScoreEditor({ roundId, match, onChange, onSave }) {
  return (
    <div>
      <div className="list" style={{ marginTop: '14px' }}>
        {setRows.map(([label, keyA, keyB]) => (
          <div
            className="item"
            key={label}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 80px 20px 80px',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <strong>{label}</strong>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              min="0"
              className="input score"
              aria-label={`${label} Team A`}
              value={match[keyA] ?? ''}
              onChange={(event) =>
                onChange(roundId, match.id, keyA, event.target.value)
              }
            />
            <b>:</b>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              min="0"
              className="input score"
              aria-label={`${label} Team B`}
              value={match[keyB] ?? ''}
              onChange={(event) =>
                onChange(roundId, match.id, keyB, event.target.value)
              }
            />
          </div>
        ))}
      </div>

      <p className="muted" style={{ marginTop: '10px' }}>
        Ein Satz reicht. Bei 1:1 Sätzen ist ein dritter Entscheidungssatz Pflicht.
        Jeder gespielte Satz muss einen Sieger haben.
      </p>

      <button className="btn primary" onClick={() => onSave(match)}>
        <Save size={16} />{' '}
        {match.completed ? 'Ergebnis korrigieren' : 'Ergebnis speichern'}
      </button>
    </div>
  );
}
