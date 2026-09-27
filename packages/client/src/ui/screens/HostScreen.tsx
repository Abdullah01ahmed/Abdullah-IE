import { useEffect, useState } from 'react';
import { DEFAULT_MATCH_SETTINGS, MAX_NAME_LENGTH, type MatchSettings } from '@tra/shared';
import { useStore } from '../../state/store';
import { session } from '../../session/Session';
import { getBridge } from '../../platform/bridge';
import { useT } from '../../i18n';
import { parseIntStrict } from '../logic/format';
import { errorMessage } from '../logic/errors';
import { ScreenFrame } from '../components/ScreenFrame';
import { MatchSettingsForm } from '../components/MatchSettingsForm';
import { Button, Field, Notice, Panel, TextInput } from '../components/primitives';
import { IconInfo, IconWarning } from '../components/icons';

const PORT_MIN = 1024;
const PORT_MAX = 65535;

export function HostScreen() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const hosting = useStore((s) => s.hosting);
  const connError = useStore((s) => s.connection.error);
  const connAddress = useStore((s) => s.connection.address);
  const updateSettings = useStore((s) => s.updateSettings);
  const setScreen = useStore((s) => s.setScreen);
  const isElectron = getBridge().isElectron;

  const [playerName, setPlayerName] = useState(settings.playerName);
  const [serverName, setServerName] = useState(settings.lastServerName);
  const [port, setPort] = useState(String(settings.lastHostPort));
  const [password, setPassword] = useState('');
  const [match, setMatch] = useState<MatchSettings>(() => structuredClone(DEFAULT_MATCH_SETTINGS));
  const [errors, setErrors] = useState<{ name?: string; port?: string }>({});

  const busy = hosting.starting;
  const defaultServerName = t('host.serverNamePlaceholder', { name: playerName.trim() || '…' });

  // A failure from an earlier attempt must not greet the user on a fresh visit.
  useEffect(() => {
    useStore.getState().setHosting({ error: null });
  }, []);

  const back = () => {
    useStore.getState().setConnection({ error: null, status: 'idle' });
    setScreen('menu');
  };

  const start = () => {
    const name = playerName.trim().slice(0, MAX_NAME_LENGTH);
    const portNum = parseIntStrict(port);
    const next: typeof errors = {};
    if (!name) next.name = t('menu.nameRequired');
    if (portNum === null || portNum < PORT_MIN || portNum > PORT_MAX) next.port = t('host.portInvalid');
    setErrors(next);
    if (next.name || next.port || portNum === null) return;
    const finalServerName = serverName.trim() || defaultServerName;
    updateSettings((s) => ({ ...s, playerName: name, lastHostPort: portNum, lastServerName: serverName.trim() }));
    // Failures surface through store.hosting.error / store.connection.error below.
    session.host({ port: portNum, password: password || undefined, serverName: finalServerName, playerName: name, settings: match }).catch(() => undefined);
  };

  const joinLocalInstead = () => {
    const portNum = parseIntStrict(port) ?? settings.lastHostPort;
    updateSettings((s) => ({ ...s, lastJoinAddress: `127.0.0.1:${portNum}` }));
    setScreen('join');
  };

  const failure = hosting.error ?? (connError ? errorMessage(t, connError, connAddress) : null);

  return (
    <ScreenFrame title={t('host.title')} subtitle={t('host.subtitle')} onBack={back} testId="screen-host">
      <div className="host-layout">
        <div className="stack">
          <Panel title={t('host.section.server')}>
            <div className="stack">
              {!isElectron && (
                <Notice tone="info" icon={<IconInfo />} title={t('host.browserTitle')}>
                  <p>{t('host.browserBody')}</p>
                  <p style={{ marginTop: 8 }}><span className="code">npm run dev:server</span></p>
                  <div style={{ marginTop: 10 }}>
                    <Button size="sm" onClick={joinLocalInstead}>{t('host.browserJoinLocal')}</Button>
                  </div>
                </Notice>
              )}
              <Field label={t('menu.playerName')} error={errors.name} htmlFor="host-name">
                <TextInput id="host-name" value={playerName} maxLength={MAX_NAME_LENGTH} placeholder={t('menu.playerNamePlaceholder')} invalid={!!errors.name} onChange={(e) => setPlayerName(e.target.value)} />
              </Field>
              <Field label={t('host.serverName')} htmlFor="host-server-name">
                <TextInput id="host-server-name" value={serverName} maxLength={40} placeholder={defaultServerName} onChange={(e) => setServerName(e.target.value)} />
              </Field>
              <Field label={t('host.port')} hint={t('host.portHint')} error={errors.port} htmlFor="host-port">
                <TextInput id="host-port" value={port} inputMode="numeric" mono invalid={!!errors.port} onChange={(e) => setPort(e.target.value)} />
              </Field>
              <Field label={t('host.password')} hint={t('host.passwordHint')} htmlFor="host-password">
                <TextInput id="host-password" type="password" value={password} maxLength={64} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
              </Field>
            </div>
          </Panel>

          {failure && (
            <Notice tone="danger" icon={<IconWarning />} title={t('error.HOST_FAILED')}>
              <span data-testid="host-error">{failure}</span>
            </Notice>
          )}

          <Button variant="primary" size="lg" block busy={busy} disabled={!isElectron} onClick={start} data-testid="host-start">
            {busy ? t('host.starting') : t('host.start')}
          </Button>
        </div>

        <Panel title={t('host.section.match')}>
          <MatchSettingsForm value={match} onChange={(patch) => setMatch((m) => ({ ...m, ...patch }))} readOnly={busy} />
        </Panel>
      </div>
    </ScreenFrame>
  );
}
