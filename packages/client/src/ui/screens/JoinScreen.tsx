import { useRef, useState } from 'react';
import { DEFAULT_PORT, MAX_NAME_LENGTH } from '@tra/shared';
import { useStore } from '../../state/store';
import { session } from '../../session/Session';
import { useT } from '../../i18n';
import { rememberAddress, validateAddress } from '../logic/address';
import { errorMessage } from '../logic/errors';
import { ScreenFrame } from '../components/ScreenFrame';
import { Button, Field, Notice, Panel, Spinner, TextInput } from '../components/primitives';
import { IconWarning } from '../components/icons';

export function JoinScreen() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const connection = useStore((s) => s.connection);
  const updateSettings = useStore((s) => s.updateSettings);
  const setScreen = useStore((s) => s.setScreen);

  const [address, setAddress] = useState(settings.lastJoinAddress);
  const [playerName, setPlayerName] = useState(settings.playerName);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; address?: string }>({});
  /** Set when the user cancels so the resulting rejection is not shown as an error. */
  const cancelledRef = useRef(false);

  const connecting = connection.status === 'connecting';

  const back = () => {
    if (connecting) session.cancelConnect();
    useStore.getState().setConnection({ error: null, status: 'idle' });
    setScreen('menu');
  };

  const connect = () => {
    const name = playerName.trim().slice(0, MAX_NAME_LENGTH);
    const valid = validateAddress(address);
    const next: typeof errors = {};
    if (!name) next.name = t('menu.nameRequired');
    if (!valid.ok) next.address = t(valid.key);
    setErrors(next);
    if (!valid.ok || next.name) return;
    cancelledRef.current = false;
    useStore.getState().setConnection({ error: null });
    session
      .join({ address: address.trim(), playerName: name, password: password || undefined })
      .then(() => {
        updateSettings((s) => ({ ...s, recentAddresses: rememberAddress(s.recentAddresses, valid.normalized) }));
      })
      .catch(() => {
        if (cancelledRef.current) useStore.getState().setConnection({ status: 'idle', error: null });
      });
  };

  const cancel = () => {
    cancelledRef.current = true;
    session.cancelConnect();
  };

  const failure = !connecting && connection.error ? errorMessage(t, connection.error, connection.address) : null;

  return (
    <ScreenFrame title={t('join.title')} subtitle={t('join.subtitle')} onBack={back} width="narrow" testId="screen-join">
      <Panel>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!connecting) connect();
          }}
        >
          <Field label={t('join.address')} hint={t('join.addressHint', { port: DEFAULT_PORT })} error={errors.address} htmlFor="join-address">
            <TextInput
              id="join-address"
              value={address}
              mono
              placeholder={t('join.addressPlaceholder')}
              invalid={!!errors.address}
              disabled={connecting}
              autoFocus
              onChange={(e) => setAddress(e.target.value)}
              data-testid="join-address"
            />
          </Field>
          {settings.recentAddresses.length > 0 && (
            <Field label={t('join.recent')}>
              <div className="recent-chips">
                {settings.recentAddresses.map((a) => (
                  <button key={a} type="button" className="chip" disabled={connecting} onClick={() => setAddress(a)}>{a}</button>
                ))}
              </div>
            </Field>
          )}
          <Field label={t('menu.playerName')} error={errors.name} htmlFor="join-name">
            <TextInput id="join-name" value={playerName} maxLength={MAX_NAME_LENGTH} placeholder={t('menu.playerNamePlaceholder')} invalid={!!errors.name} disabled={connecting} onChange={(e) => setPlayerName(e.target.value)} />
          </Field>
          <Field label={t('join.password')} htmlFor="join-password">
            <TextInput id="join-password" type="password" value={password} maxLength={64} placeholder={t('join.passwordPlaceholder')} autoComplete="off" disabled={connecting} onChange={(e) => setPassword(e.target.value)} />
          </Field>

          {failure && (
            <Notice tone="danger" icon={<IconWarning />}>
              <span data-testid="join-error">{failure}</span>
            </Notice>
          )}

          {connecting ? (
            <div className="connecting" role="status">
              <Spinner />
              <span className="spacer">{t('join.connecting', { address: connection.address })}</span>
              <Button variant="ghost" size="sm" onClick={cancel}>{t('common.cancel')}</Button>
            </div>
          ) : (
            <Button type="submit" variant="primary" size="lg" block data-testid="join-connect">{t('join.connect')}</Button>
          )}
        </form>
      </Panel>
    </ScreenFrame>
  );
}
