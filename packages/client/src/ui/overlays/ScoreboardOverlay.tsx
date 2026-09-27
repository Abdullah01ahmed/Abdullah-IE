/** Hold-Tab scoreboard during a match. */
import { useStore } from '../../state/store';
import { useT } from '../../i18n';
import { formatClock } from '../logic/format';
import { ScoreboardTeams } from '../components/ScoreboardTable';

export function ScoreboardOverlay() {
  const t = useT();
  const board = useStore((s) => s.scoreboard);
  const selfId = useStore((s) => s.selfId);
  const room = useStore((s) => s.room);
  if (!board) return null;
  const disconnected = new Set(room?.players.filter((p) => !p.connected && !p.isBot).map((p) => p.id) ?? []);
  return (
    <div className="overlay">
      <div className="panel panel--glass sb-overlay" data-testid="scoreboard-overlay">
        <header className="sb-overlay__head">
          <h2 className="panel__title">{t('scoreboard.title')}</h2>
          <div className="sb-overlay__score">
            <span className="text-tigris">{board.teams.tigris}</span>
            <span className="muted">:</span>
            <span className="text-euphrates">{board.teams.euphrates}</span>
          </div>
          <span className="dim">{t('scoreboard.timeLeft')} <span className="num">{formatClock(board.timeLeftSec)}</span></span>
        </header>
        <ScoreboardTeams board={board} selfId={selfId} hostId={room?.hostId ?? null} disconnectedIds={disconnected} />
      </div>
    </div>
  );
}
