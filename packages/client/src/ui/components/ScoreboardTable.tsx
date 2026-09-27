/** Two per-team score tables (used by the Tab overlay and the results screen). */
import type { ScoreEntry, ScoreboardState, Team } from '@tra/shared';
import { TEAMS } from '@tra/shared';
import { useT } from '../../i18n';
import { teamEntries } from '../logic/scoreboard';
import { Badge, Ping } from './primitives';
import { IconBot, IconCrown } from './icons';

export interface ScoreboardTeamsProps {
  board: ScoreboardState;
  selfId: number | null;
  hostId: number | null;
  /** Ids of humans currently in their reconnection grace period (rendered dimmed). */
  disconnectedIds?: ReadonlySet<number>;
}

export function ScoreboardTeams({ board, selfId, hostId, disconnectedIds }: ScoreboardTeamsProps) {
  return (
    <div className="sb-overlay__teams">
      {TEAMS.map((team) => (
        <TeamTable key={team} team={team} rows={teamEntries(board.players, team)} score={board.teams[team]} selfId={selfId} hostId={hostId} disconnectedIds={disconnectedIds} />
      ))}
    </div>
  );
}

interface TeamTableProps {
  team: Team;
  rows: ScoreEntry[];
  score: number;
  selfId: number | null;
  hostId: number | null;
  disconnectedIds?: ReadonlySet<number>;
}

function TeamTable({ team, rows, score, selfId, hostId, disconnectedIds }: TeamTableProps) {
  const t = useT();
  return (
    <table className={`sb team-${team}`} data-testid={`scoreboard-${team}`}>
      <thead>
        <tr className="sb__team-head">
          <th colSpan={2}>{t(team === 'tigris' ? 'team.tigris' : 'team.euphrates')}</th>
          <th colSpan={3} className="sb__num sb__teamscore">{score}</th>
        </tr>
        <tr>
          <th className="sb__name">{t('scoreboard.player')}</th>
          <th className="sb__num">{t('scoreboard.kills')}</th>
          <th className="sb__num">{t('scoreboard.deaths')}</th>
          <th className="sb__num">{t('scoreboard.score')}</th>
          <th className="sb__num">{t('scoreboard.ping')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr className="sb__empty"><td colSpan={5}>{t('scoreboard.empty')}</td></tr>
        )}
        {rows.map((p) => {
          const cls = ['sb__row', p.id === selfId ? 'sb__row--self' : '', disconnectedIds?.has(p.id) ? 'sb__row--dc' : ''].filter(Boolean).join(' ');
          return (
            <tr key={p.id} className={cls}>
              <td className="sb__name">
                <span className="sb__name-inner">
                  <span>{p.name}</span>
                  {p.id === selfId && <Badge tone="brass">{t('common.you')}</Badge>}
                  {p.id === hostId && <Badge tone="brass" title={t('common.host')}><IconCrown size={12} /></Badge>}
                  {p.isBot && <Badge tone="muted" title={t('common.bot')}><IconBot size={12} />{t('common.bot')}</Badge>}
                </span>
              </td>
              <td className="sb__num">{p.kills}</td>
              <td className="sb__num">{p.deaths}</td>
              <td className="sb__num">{p.score}</td>
              <td className="sb__num"><Ping ms={p.ping} isBot={p.isBot} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
