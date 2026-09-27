import { useEffect, useMemo, useState } from 'react';
import { getMapOrDefault, type Team } from '@tra/shared';
import { useStore } from '../../state/store';
import { session } from '../../session/Session';
import { bi, useLang, useT, type TKey } from '../../i18n';
import { ScoreboardTeams } from '../components/ScoreboardTable';
import { Button, ConfirmDialog, Panel, TeamName } from '../components/primitives';
import { IconTrophy } from '../components/icons';

export function ResultsScreen() {
  const t = useT();
  const lang = useLang();
  const results = useStore((s) => s.results);
  const selfId = useStore((s) => s.selfId);
  const selfTeam = useStore((s) => s.hud.selfTeam);
  const room = useStore((s) => s.room);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Local countdown mirroring results.returnToLobbySec from the moment results arrived.
  const startedAt = useMemo(() => performance.now(), [results]);
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!results) return null;

  const remaining = Math.max(0, Math.ceil(results.returnToLobbySec - (now - startedAt) / 1000));
  const outcome: 'victory' | 'defeat' | 'draw' = results.winner === 'draw' ? 'draw' : results.winner === selfTeam ? 'victory' : 'defeat';
  const bannerTeam: Team | null = results.winner === 'draw' ? null : results.winner;
  const board = results.scoreboard;
  const mvp = results.mvpId != null ? board.players.find((p) => p.id === results.mvpId) : undefined;
  const nextMap = getMapOrDefault(results.nextMapId);
  const disconnected = new Set(room?.players.filter((p) => !p.connected && !p.isBot).map((p) => p.id) ?? []);

  const leave = () => {
    if (session.isHosting) setConfirmLeave(true);
    else void session.leave();
  };

  return (
    <div className="results" data-testid="screen-results">
      <div className="results__inner">
        <div className={`results__banner${bannerTeam ? ` team-${bannerTeam}` : ''}`}>
          <h1 className="results__outcome" data-testid="results-outcome">{t(`results.${outcome}` as TKey)}</h1>
          <p className="results__reason">
            {bannerTeam && <>{t('results.winner', { team: t(bannerTeam === 'tigris' ? 'team.tigris' : 'team.euphrates') })} · </>}
            {t(`results.reason.${results.reason}` as TKey)}
          </p>
        </div>

        <div className="panel results__scores">
          <div className="results__team team-tigris">
            <span className="results__team-name"><TeamName team="tigris" /></span>
            <span className="results__team-score">{board.teams.tigris}</span>
          </div>
          <span className="results__vs">—</span>
          <div className="results__team team-euphrates">
            <span className="results__team-name"><TeamName team="euphrates" /></span>
            <span className="results__team-score">{board.teams.euphrates}</span>
          </div>
        </div>

        <div className="results__grid">
          <div className="stack">
            {mvp && (
              <div className={`panel mvp team-${mvp.team}`} data-testid="results-mvp">
                <IconTrophy size={28} className="text-team" />
                <span className="mvp__badge">{t('results.mvp')}</span>
                <span className="mvp__name">{mvp.name}</span>
                <span className="mvp__score">{mvp.score}</span>
                <span className="dim">{t('results.kd', { k: mvp.kills, d: mvp.deaths })}</span>
              </div>
            )}
            <Panel>
              <div className="stack">
                <div className="row row--between">
                  <span className="dim">{t('results.nextMap')}</span>
                  <strong>{bi(lang, nextMap.name, nextMap.nameAr)}</strong>
                </div>
                <div className="row row--between">
                  <span className="dim" data-testid="results-countdown">{t('results.backToLobby', { n: t('common.seconds', { n: remaining }) })}</span>
                </div>
              </div>
            </Panel>
          </div>
          <Panel flush title={t('scoreboard.title')}>
            <ScoreboardTeams board={board} selfId={selfId} hostId={room?.hostId ?? null} disconnectedIds={disconnected} />
          </Panel>
        </div>

        <div className="results__actions">
          <Button variant="danger" onClick={leave} data-testid="results-leave">{t('common.leave')}</Button>
          <Button variant="primary" size="lg" onClick={() => session.continueToLobby()} data-testid="results-continue">{t('common.continue')}</Button>
        </div>
      </div>

      {confirmLeave && (
        <ConfirmDialog
          title={t('pause.leaveConfirmTitle')}
          body={t('pause.leaveConfirmHost')}
          confirmLabel={t('common.leave')}
          danger
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => { setConfirmLeave(false); void session.leave(); }}
        />
      )}
    </div>
  );
}
