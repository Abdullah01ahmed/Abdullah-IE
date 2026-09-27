import { useEffect, useRef, useState } from 'react';
import {
  BOT_DIFFICULTIES,
  GAME_MODE_NAMES,
  MAX_PLAYERS,
  TEAMS,
  TEAM_SIZE,
  getMapOrDefault,
  type BotDifficultyId,
  type RoomPlayer,
  type Team,
} from '@tra/shared';
import { selectIsHost, selectSelf, useStore } from '../../state/store';
import { session } from '../../session/Session';
import { getBridge } from '../../platform/bridge';
import { bi, useLang, useT, type TKey } from '../../i18n';
import { HOSTING_GUIDE_URL } from '../logic/constants';
import { ScreenFrame } from '../components/ScreenFrame';
import { MatchSettingsForm } from '../components/MatchSettingsForm';
import { Badge, Button, ConfirmDialog, Panel, Ping, Select, TextInput } from '../components/primitives';
import { IconBot, IconCheck, IconCopy, IconCrown, IconExternal, IconLock, IconServer, IconStar8, IconX } from '../components/icons';

export function LobbyScreen() {
  const t = useT();
  const lang = useLang();
  const room = useStore((s) => s.room);
  const self = useStore(selectSelf);
  const isHost = useStore(selectIsHost);
  const hosting = useStore((s) => s.hosting);
  const setScreen = useStore((s) => s.setScreen);
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!room) return null;

  const map = getMapOrDefault(room.settings.mapId);
  const modeName = bi(lang, GAME_MODE_NAMES[room.settings.mode].en, GAME_MODE_NAMES[room.settings.mode].ar);
  const host = room.hostId != null ? room.players.find((p) => p.id === room.hostId) : undefined;
  const counts: Record<Team, number> = { tigris: 0, euphrates: 0 };
  for (const p of room.players) counts[p.team]++;

  const leave = () => {
    if (session.isHosting) setConfirmLeave(true);
    else void session.leave();
  };

  return (
    <ScreenFrame
      title={t('lobby.title')}
      testId="screen-lobby"
      actions={
        <>
          <Button variant="ghost" onClick={() => setScreen('loadout')}>{t('menu.loadout')}</Button>
          <Button variant="ghost" onClick={() => setScreen('settings')}>{t('menu.settings')}</Button>
          <Button variant="danger" onClick={leave} data-testid="lobby-leave">{t('lobby.leave')}</Button>
        </>
      }
    >
      <div className="lobby">
        <header className="panel lobby__header">
          <IconServer size={22} className="dim" />
          <h2 className="lobby__name">{room.serverName}</h2>
          <div className="lobby__meta">
            <span>{bi(lang, map.name, map.nameAr)} · {modeName}</span>
            <Badge>{t('lobby.players', { n: room.players.length, max: MAX_PLAYERS })}</Badge>
            {room.passwordProtected && <Badge tone="brass"><IconLock size={12} />{t('lobby.passwordProtected')}</Badge>}
            {room.dedicated && <Badge>{t('lobby.dedicated')}</Badge>}
            {isHost ? (
              <Badge tone="brass"><IconCrown size={12} />{t('lobby.youAreHost')}</Badge>
            ) : host ? (
              <Badge><IconCrown size={12} />{t('lobby.hostIs', { name: host.name })}</Badge>
            ) : null}
          </div>
        </header>

        <div className="lobby__main">
          {room.countdown != null && (
            <div className="countdown" role="status" data-testid="lobby-countdown">
              <span className="countdown__text">
                <span className="countdown__n">{Math.ceil(room.countdown)}</span>
                <span>{t('lobby.countdown', { n: t('common.seconds', { n: Math.ceil(room.countdown) }) })}</span>
              </span>
              {isHost && <Button variant="danger" size="sm" onClick={() => session.cancelStart()}>{t('lobby.cancelCountdown')}</Button>}
            </div>
          )}

          <div className="lobby__teams">
            {TEAMS.map((team) => (
              <TeamPanel key={team} team={team} players={room.players.filter((p) => p.team === team)} selfId={self?.id ?? null} hostId={room.hostId} isHost={isHost} />
            ))}
          </div>

          <div className="panel lobby__actions">
            {TEAMS.map((team) => (
              <Button
                key={team}
                variant="team"
                className={`team-${team}`}
                disabled={!self || self.team === team || counts[team] >= TEAM_SIZE}
                title={counts[team] >= TEAM_SIZE ? t('lobby.teamFull') : undefined}
                onClick={() => session.setTeam(team)}
                data-testid={`join-${team}`}
              >
                {t('lobby.joinTeam', { team: t(team === 'tigris' ? 'team.tigris' : 'team.euphrates') })}
              </Button>
            ))}
            <Button variant="ghost" disabled={!self || (counts.tigris >= TEAM_SIZE && counts.euphrates >= TEAM_SIZE)} onClick={() => session.setTeam('auto')}>
              {t('lobby.auto')}
            </Button>
            <span className="spacer" />
            <Button
              variant={self?.ready ? 'secondary' : 'primary'}
              icon={self?.ready ? <IconX size={16} /> : <IconCheck size={16} />}
              disabled={!self}
              onClick={() => self && session.setReady(!self.ready)}
              data-testid="lobby-ready"
            >
              {self?.ready ? t('lobby.unready') : t('lobby.readyUp')}
            </Button>
            {isHost ? (
              <Button variant="primary" size="lg" disabled={room.countdown != null} onClick={() => session.startMatch()} data-testid="lobby-start">
                {t('lobby.start')}
              </Button>
            ) : (
              <span className="dim" role="status">{room.dedicated ? t('lobby.waitingServer') : t('lobby.waitingHost')}</span>
            )}
          </div>

          <Panel title={t('lobby.settings')}>
            <MatchSettingsForm value={room.settings} readOnly={!isHost} onChange={(patch) => session.updateSettings(patch)} />
          </Panel>
        </div>

        <aside className="lobby__side">
          {hosting.running && <HostingInfo port={hosting.port ?? 0} addresses={hosting.lanAddresses} />}
          <ChatPanel />
        </aside>
      </div>

      {confirmLeave && (
        <ConfirmDialog
          title={t('lobby.leaveConfirmTitle')}
          body={t('lobby.leaveConfirmHost')}
          confirmLabel={t('common.leave')}
          danger
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => { setConfirmLeave(false); void session.leave(); }}
        />
      )}
    </ScreenFrame>
  );
}

// ---- team panel ------------------------------------------------------------

interface TeamPanelProps {
  team: Team;
  players: RoomPlayer[];
  selfId: number | null;
  hostId: number | null;
  isHost: boolean;
}

function TeamPanel({ team, players, selfId, hostId, isHost }: TeamPanelProps) {
  const t = useT();
  const slots: (RoomPlayer | null)[] = [...players];
  while (slots.length < TEAM_SIZE) slots.push(null);
  return (
    <section className={`panel team-panel team-${team}`} data-testid={`team-${team}`}>
      <header className="panel__head">
        <h3 className="team-panel__title"><IconStar8 size={16} />{t(team === 'tigris' ? 'team.tigris' : 'team.euphrates')}</h3>
        <span className="team-panel__count">{players.length}/{TEAM_SIZE}</span>
      </header>
      <div className="panel__body panel__body--flush">
        {slots.map((p, i) => (p ? <PlayerSlot key={p.id} player={p} isSelf={p.id === selfId} isRoomHost={p.id === hostId} canManage={isHost} /> : <EmptySlot key={`empty-${i}`} team={team} canAdd={isHost} />))}
      </div>
    </section>
  );
}

function PlayerSlot({ player: p, isSelf, isRoomHost, canManage }: { player: RoomPlayer; isSelf: boolean; isRoomHost: boolean; canManage: boolean }) {
  const t = useT();
  return (
    <div className={`slot${isSelf ? ' slot--self' : ''}`}>
      <span className={`slot__ready${p.ready ? ' slot__ready--on' : ''}`} title={p.ready ? t('lobby.ready') : t('lobby.notReady')} aria-label={p.ready ? t('lobby.ready') : t('lobby.notReady')}>
        {p.ready && <IconCheck size={12} />}
      </span>
      <span className="slot__name">
        <span className="slot__name-text">{p.name}</span>
        {isSelf && <Badge tone="brass">{t('common.you')}</Badge>}
        {isRoomHost && <Badge tone="brass" title={t('common.host')}><IconCrown size={12} /></Badge>}
        {p.isBot && <Badge tone="muted" title={t('common.bot')}><IconBot size={12} />{t('common.bot')}</Badge>}
        {!p.connected && !p.isBot && <Badge tone="danger">{t('lobby.reconnecting')}</Badge>}
      </span>
      <span className="slot__meta">
        {p.isBot && canManage ? (
          <Select<BotDifficultyId>
            small
            value={p.botDifficulty ?? 'normal'}
            options={BOT_DIFFICULTIES.map((d) => ({ value: d, label: t(`difficulty.${d}` as TKey) }))}
            onChange={(d) => session.setBotDifficulty(p.id, d)}
            aria-label={t('lobby.difficulty')}
          />
        ) : p.isBot ? (
          <span className="badge">{t(`difficulty.${p.botDifficulty ?? 'normal'}` as TKey)}</span>
        ) : (
          <Ping ms={p.ping} />
        )}
        {canManage && !isSelf && (
          <Button variant="ghost" size="sm" className="btn--icon" title={p.isBot ? t('lobby.remove') : t('lobby.kick')} aria-label={p.isBot ? t('lobby.remove') : t('lobby.kick')} onClick={() => (p.isBot ? session.removeBot(p.id) : session.kick(p.id))}>
            <IconX size={16} />
          </Button>
        )}
      </span>
    </div>
  );
}

function EmptySlot({ team, canAdd }: { team: Team; canAdd: boolean }) {
  const t = useT();
  return (
    <div className="slot slot--empty">
      <span className="slot__ready slot__ready--empty" />
      <span className="slot__name"><span className="slot__name-text">{t('lobby.slotEmpty')}</span></span>
      <span className="slot__meta">
        {canAdd && (
          <Button variant="ghost" size="sm" icon={<IconBot size={14} />} onClick={() => session.addBot(team)}>{t('lobby.addBot')}</Button>
        )}
      </span>
    </div>
  );
}

// ---- hosting info ----------------------------------------------------------

function HostingInfo({ port, addresses }: { port: number; addresses: string[] }) {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <Panel title={t('hosting.title')}>
      <div className="stack">
        <div>
          <div className="field__label" style={{ marginBottom: 6 }}>{t('hosting.lan')} · {t('hosting.port')} <span className="ltr">{port}</span></div>
          {addresses.length === 0 && <p className="field__hint">{t('hosting.lanNone')}</p>}
          {addresses.map((a) => {
            const full = `${a}:${port}`;
            return (
              <div key={a} className="hostinfo__addr">
                <span className="code">{full}</span>
                <Button variant="ghost" size="sm" icon={copied === full ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={() => void copy(full)}>
                  {copied === full ? t('common.copied') : t('common.copy')}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="field__hint">{t('hosting.internetHint', { port })}</p>
        <Button size="sm" icon={<IconExternal size={14} />} onClick={() => void getBridge().openExternal(HOSTING_GUIDE_URL)}>
          {t('hosting.guide')}
        </Button>
      </div>
    </Panel>
  );
}

// ---- chat ------------------------------------------------------------------

function ChatPanel() {
  const t = useT();
  const chat = useStore((s) => s.chat);
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    session.sendChat(trimmed);
    setText('');
  };

  return (
    <section className="panel chat" data-testid="lobby-chat">
      <header className="panel__head"><h3 className="panel__title">{t('lobby.chat')}</h3></header>
      <div ref={logRef} className="chat__log">
        {chat.length === 0 && <span className="muted">{t('lobby.chatEmpty')}</span>}
        {chat.map((m) => (
          <div key={m.id} className={`chat__msg team-${m.team}`}>
            <span className="chat__who">{m.name}:</span>
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <TextInput value={text} maxLength={200} placeholder={t('lobby.chatPlaceholder')} onChange={(e) => setText(e.target.value)} aria-label={t('lobby.chat')} />
        <Button type="submit" size="sm" disabled={!text.trim()}>{t('lobby.send')}</Button>
      </form>
    </section>
  );
}
