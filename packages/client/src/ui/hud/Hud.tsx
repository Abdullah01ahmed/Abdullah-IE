/**
 * In-match heads-up display. Purely presentational: every widget reads a
 * narrow slice of store.hud / store.connection so only the affected widget
 * re-renders when the game publishes new values.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { WEAPONS, isWeaponId, type Team } from '@tra/shared';
import { useStore, type Announcement, type KillFeedEntry } from '../../state/store';
import { bi, useLang, useT, type TKey } from '../../i18n';
import { useClock } from '../hooks/useClock';
import { formatClock } from '../logic/format';
import { ANNOUNCEMENT_TTL_MS, DAMAGE_INDICATOR_TTL_MS, HITMARKER_KILL_MS, HITMARKER_MS, KILLFEED_TTL_MS, LOW_HEALTH } from '../logic/constants';
import { IconHeadshot, WeaponGlyph } from '../components/icons';
import { ChatOverlay } from './ChatOverlay';

const teamKey = (team: Team): TKey => (team === 'tigris' ? 'team.tigris' : 'team.euphrates');

/**
 * Render a translated template with one `{param}` placeholder replaced by a
 * React node (so the value can be styled) instead of plain text.
 */
function emphasize(template: string, param: string, value: ReactNode): ReactNode {
  const [before, after = ''] = template.split(`{${param}}`);
  return (
    <>
      {before}
      {value}
      {after}
    </>
  );
}

export function Hud() {
  const lang = useLang();
  return (
    <div className={`hud${lang === 'ar' ? ' hud--rtl' : ''}`} data-testid="hud" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <DamageVignette />
      <ScoreStrip />
      <ConnectionIndicator />
      <KillFeed />
      <CenterLayer />
      <AnnouncementBanner />
      <HealthPanel />
      <AmmoPanel />
      <DeathOverlay />
      <ChatOverlay />
    </div>
  );
}

// ---- health ------------------------------------------------------------------

function DamageVignette() {
  const health = useStore((s) => s.hud.health);
  const maxHealth = useStore((s) => s.hud.maxHealth);
  const alive = useStore((s) => s.hud.alive);
  const ratio = maxHealth > 0 ? health / maxHealth : 1;
  // Fades in below 60% and reaches full strength at LOW_HEALTH.
  const opacity = !alive ? 0 : ratio >= 0.6 ? 0 : Math.min(1, (0.6 - ratio) / (0.6 - LOW_HEALTH / 100));
  return <div className={`hud__vignette${health < LOW_HEALTH && alive ? ' hud__vignette--pulse' : ''}`} style={{ opacity }} aria-hidden="true" />;
}

function HealthPanel() {
  const t = useT();
  const health = useStore((s) => s.hud.health);
  const maxHealth = useStore((s) => s.hud.maxHealth);
  const alive = useStore((s) => s.hud.alive);
  if (!alive) return null;
  const pct = maxHealth > 0 ? Math.max(0, Math.min(100, (health / maxHealth) * 100)) : 0;
  return (
    <div className={`hud__health${health < LOW_HEALTH ? ' hud__health--low' : ''}`} data-testid="hud-health">
      <div className="hud__health-row">
        <span className="hud__health-num">{Math.round(health)}</span>
        <span className="hud__health-label">{t('hud.health')}</span>
      </div>
      <div className="hud__health-track" role="meter" aria-valuemin={0} aria-valuemax={maxHealth} aria-valuenow={health}>
        <div className="hud__health-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---- ammo & weapons ------------------------------------------------------------

function AmmoPanel() {
  const t = useT();
  const lang = useLang();
  const ammo = useStore((s) => s.hud.ammo);
  const reserve = useStore((s) => s.hud.reserve);
  const weaponId = useStore((s) => s.hud.weaponId);
  const weaponIndex = useStore((s) => s.hud.weaponIndex);
  const reloading = useStore((s) => s.hud.reloading);
  const alive = useStore((s) => s.hud.alive);
  const loadout = useStore((s) => s.loadout);
  if (!alive) return null;
  const def = WEAPONS[weaponId];
  const low = ammo <= Math.ceil(def.magSize * 0.25);
  const slots = [loadout.primary, loadout.secondary];
  return (
    <div className="hud__ammo" data-testid="hud-ammo">
      {reloading && <span className="hud__reloading">{t('hud.reloading')}</span>}
      <div className="hud__ammo-count">
        <span className={`hud__ammo-mag${low ? ' hud__ammo-mag--low' : ''}`}>{ammo}</span>
        <span className="hud__ammo-reserve">{reserve}</span>
      </div>
      <span className="hud__weapon-name">{bi(lang, def.name, def.nameAr)}</span>
      <div className="hud__slots">
        {slots.map((id, i) => (
          <span key={i} className={`hud__slot${i === weaponIndex ? ' hud__slot--active' : ''}`}>
            <span className="hud__slot-key">{i + 1}</span>
            <WeaponGlyph weapon={id} size={16} />
            <span>{bi(lang, WEAPONS[id].name, WEAPONS[id].nameAr)}</span>
          </span>
        ))}
        <span className="hud__slot hud__slot--equip" title={t('hud.lethal')}><span className="hud__slot-key">G</span>—</span>
        <span className="hud__slot hud__slot--equip" title={t('hud.tactical')}><span className="hud__slot-key">F</span>—</span>
      </div>
    </div>
  );
}

// ---- score strip ----------------------------------------------------------------

function ScoreStrip() {
  const t = useT();
  const board = useStore((s) => s.scoreboard);
  const selfTeam = useStore((s) => s.hud.selfTeam);
  const teamScore = useStore((s) => s.hud.teamScore);
  const enemyScore = useStore((s) => s.hud.enemyScore);
  const timeLeft = useStore((s) => s.hud.timeLeftSec);
  const limit = useStore((s) => s.hud.scoreLimit);
  // Prefer the authoritative board; fall back to the HUD's self/enemy pair.
  const scores: Record<Team, number> = board
    ? board.teams
    : selfTeam === 'euphrates'
      ? { tigris: enemyScore, euphrates: teamScore }
      : { tigris: teamScore, euphrates: enemyScore };
  const urgent = timeLeft > 0 && timeLeft <= 60;
  return (
    <div className="hud__strip" data-testid="hud-strip">
      <div className="hud__strip-team team-tigris">
        <span className="hud__strip-bar" />
        <span className="hud__strip-name">{t('team.tigris')}</span>
        <span className="hud__strip-score">{scores.tigris}</span>
      </div>
      <div className="hud__strip-mid">
        <span className={`hud__strip-timer${urgent ? ' hud__strip-timer--urgent' : ''}`}>{formatClock(timeLeft)}</span>
        {limit > 0 && <span className="hud__strip-limit">{t('hud.limit', { n: limit })}</span>}
      </div>
      <div className="hud__strip-team hud__strip-team--right team-euphrates">
        <span className="hud__strip-score">{scores.euphrates}</span>
        <span className="hud__strip-name">{t('team.euphrates')}</span>
        <span className="hud__strip-bar" />
      </div>
    </div>
  );
}

// ---- kill feed --------------------------------------------------------------------

function KillFeed() {
  const feed = useStore((s) => s.hud.killFeed);
  const selfId = useStore((s) => s.selfId);
  const now = useClock(1000, feed.length > 0);
  const visible = feed.filter((e) => now - e.time < KILLFEED_TTL_MS + 500);
  return (
    <div className="hud__killfeed" data-testid="hud-killfeed">
      {visible.map((e) => <KillRow key={e.id} entry={e} selfId={selfId} />)}
    </div>
  );
}

function KillRow({ entry: e, selfId }: { entry: KillFeedEntry; selfId: number | null }) {
  const t = useT();
  const lang = useLang();
  const involved = e.killerId === selfId || e.victimId === selfId;
  const environmental = e.killerId === e.victimId || e.weapon === 'fall' || e.weapon === 'world';
  return (
    <div className={`hud__kill${involved ? ' hud__kill--self' : ''}`}>
      {!environmental && <span className={`hud__kill-name team-${e.killerTeam}`}>{e.killerName}</span>}
      <span className="hud__kill-glyph" title={weaponName(t, e.weapon, lang)}><WeaponGlyph weapon={e.weapon} size={16} /></span>
      {e.headshot && <span className="hud__kill-hs" title={t('hud.headshot')}><IconHeadshot size={14} /></span>}
      <span className={`hud__kill-name team-${e.victimTeam}`}>{e.victimName}</span>
    </div>
  );
}

function weaponName(t: ReturnType<typeof useT>, weapon: string, lang: 'en' | 'ar'): string {
  if (isWeaponId(weapon)) return bi(lang, WEAPONS[weapon].name, WEAPONS[weapon].nameAr);
  if (weapon === 'melee') return t('weapon.melee');
  if (weapon === 'fall') return t('weapon.fall');
  return t('weapon.world');
}

// ---- centre: crosshair, hitmarker, damage arcs -------------------------------------

function CenterLayer() {
  return (
    <div className="hud__center" aria-hidden="true">
      <Crosshair />
      <Hitmarker />
      <DamageArcs />
    </div>
  );
}

function Crosshair() {
  const ads = useStore((s) => s.hud.ads);
  const alive = useStore((s) => s.hud.alive);
  const sprinting = useStore((s) => s.hud.sprinting);
  const spread = useStore((s) => s.hud.spread ?? 0);
  const paused = useStore((s) => s.paused);
  const hidden = ads || !alive || paused;
  // Gap widens with published spread (movement / air) and while sprinting.
  const gap = 6 + Math.min(1, Math.max(0, spread)) * 16 + (sprinting ? 8 : 0);
  return (
    <div className={`crosshair${hidden ? ' crosshair--hidden' : ''}`} style={{ ['--gap' as string]: `${gap}px` }} data-testid="crosshair">
      <span className="crosshair__line crosshair__line--t" />
      <span className="crosshair__line crosshair__line--b" />
      <span className="crosshair__line crosshair__line--l" />
      <span className="crosshair__line crosshair__line--r" />
      <span className="crosshair__dot" />
    </div>
  );
}

function Hitmarker() {
  const marker = useStore((s) => s.hud.hitmarker);
  const [shown, setShown] = useState<typeof marker>(null);
  useEffect(() => {
    if (!marker) return;
    setShown(marker);
    const ttl = marker.kill ? HITMARKER_KILL_MS : HITMARKER_MS;
    const id = setTimeout(() => setShown((m) => (m === marker ? null : m)), ttl);
    return () => clearTimeout(id);
  }, [marker]);
  if (!shown) return null;
  const cls = ['hitmarker', shown.kill ? 'hitmarker--kill' : '', shown.headshot ? 'hitmarker--headshot' : ''].filter(Boolean).join(' ');
  return (
    <svg key={shown.time} className={cls} viewBox="0 0 28 28" data-testid="hitmarker">
      <g stroke="currentColor" strokeWidth={shown.kill ? 3 : 2.2} strokeLinecap="round">
        <path d="M5 5l6 6M23 5l-6 6M5 23l6-6M23 23l-6-6" />
        {shown.headshot && <circle cx="14" cy="14" r="11" strokeWidth={1.2} fill="none" />}
      </g>
    </svg>
  );
}

function DamageArcs() {
  const indicators = useStore((s) => s.hud.damageIndicators);
  const yaw = useStore((s) => s.hud.yaw);
  const now = useClock(250, indicators.length > 0);
  const live = indicators.filter((d) => now - d.time < DAMAGE_INDICATOR_TTL_MS + 100);
  return (
    <>
      {live.map((d) => {
        // Relative bearing: yaw 0 is straight ahead (top of screen), positive turns clockwise.
        const rel = d.yaw - yaw;
        return (
          <svg key={d.id} className="dmg-arc" viewBox="0 0 220 220" style={{ transform: `rotate(${rel}rad)` }} data-testid="damage-arc">
            <path d="M65 32.06A90 90 0 0 1 155 32.06" fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" opacity={Math.min(1, 0.55 + d.amount / 60)} />
          </svg>
        );
      })}
    </>
  );
}

// ---- announcements ------------------------------------------------------------------

function announcementText(t: ReturnType<typeof useT>, a: Announcement, selfTeam: Team | null, scoreLimit: number): { title: string; sub?: string; cls: string } {
  switch (a.kind) {
    case 'match_start':
      return { title: t('announce.match_start'), sub: scoreLimit > 0 ? t('announce.match_start.sub', { n: scoreLimit }) : undefined, cls: '' };
    case 'lead_taken':
    case 'lead_lost': {
      const us = a.team != null && a.team === selfTeam;
      const key = `announce.${a.kind}.${us ? 'us' : 'them'}` as TKey;
      return { title: t(key, { team: a.team ? t(teamKey(a.team)) : '' }), cls: a.team ? `hud__announce--team team-${a.team}` : '' };
    }
    case 'victory':
      return { title: t('announce.victory'), cls: 'hud__announce--victory' };
    case 'defeat':
      return { title: t('announce.defeat'), cls: 'hud__announce--defeat' };
    default:
      return { title: t(`announce.${a.kind}` as TKey), cls: '' };
  }
}

function AnnouncementBanner() {
  const t = useT();
  const announcement = useStore((s) => s.hud.announcement);
  const selfTeam = useStore((s) => s.hud.selfTeam);
  const scoreLimit = useStore((s) => s.hud.scoreLimit);
  const [shown, setShown] = useState<Announcement | null>(null);
  useEffect(() => {
    if (!announcement) return;
    setShown(announcement);
    const id = setTimeout(() => setShown((a) => (a === announcement ? null : a)), ANNOUNCEMENT_TTL_MS);
    return () => clearTimeout(id);
  }, [announcement]);
  if (!shown) return null;
  const { title, sub, cls } = announcementText(t, shown, selfTeam, scoreLimit);
  return (
    <div key={shown.time} className={`hud__announce ${cls}`.trim()} role="status" data-testid="hud-announce">
      <span className="hud__announce-title">{title}</span>
      {sub && <span className="hud__announce-sub">{sub}</span>}
    </div>
  );
}

// ---- death overlay -------------------------------------------------------------------

function DeathOverlay() {
  const t = useT();
  const lang = useLang();
  const alive = useStore((s) => s.hud.alive);
  const respawnIn = useStore((s) => s.hud.respawnIn);
  const killedBy = useStore((s) => s.hud.killedBy);
  const selfId = useStore((s) => s.selfId);
  const room = useStore((s) => s.room);
  if (alive) return null;
  const killerTeam = killedBy ? room?.players.find((p) => p.id === killedBy.id)?.team : undefined;
  const suicide = !killedBy || killedBy.id === selfId;
  const n = Math.ceil(respawnIn);
  return (
    <div className="hud__death" data-testid="hud-death">
      <h2 className="hud__death-title">{t('hud.died')}</h2>
      {!suicide && killedBy && (
        <p className={`hud__death-by${killerTeam ? ` team-${killerTeam}` : ''}`}>
          {emphasize(t('hud.killedBy'), 'name', <strong>{killedBy.name}</strong>)} · {t('hud.killedWith', { weapon: weaponName(t, killedBy.weapon, lang) })}
        </p>
      )}
      <p className="hud__death-respawn">
        {n > 0 ? emphasize(t('hud.respawnIn'), 'n', <span className="hud__death-n">{n}</span>) : t('hud.respawnNow')}
      </p>
    </div>
  );
}

// ---- connection / fps -------------------------------------------------------------------

function ConnectionIndicator() {
  const t = useT();
  const status = useStore((s) => s.connection.status);
  const ping = useStore((s) => s.connection.ping);
  const quality = useStore((s) => s.connection.quality);
  const showFps = useStore((s) => s.settings.graphics.showFps);
  const fps = useStore((s) => s.hud.fps);
  const down = status !== 'connected';
  const label = status === 'connecting' ? t('hud.reconnecting') : down ? t('hud.disconnected') : `${Math.round(ping)} ms`;
  return (
    <div className={`hud__conn ${down ? 'hud__conn--down' : `hud__conn--${quality}`}`} data-testid="hud-connection" title={t('hud.connected')}>
      <span className="hud__conn-bars" aria-hidden="true"><i /><i /><i /><i /></span>
      <span className="ltr">{label}</span>
      {showFps && <span className="hud__fps ltr" data-testid="hud-fps">{Math.round(fps)} {t('hud.fps')}</span>}
    </div>
  );
}
