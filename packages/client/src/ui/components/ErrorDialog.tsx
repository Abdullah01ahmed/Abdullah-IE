/** Modal shown on the main menu when store.connection.error is set (rejects, disconnects, host failures). */
import { useCallback } from 'react';
import { useStore } from '../../state/store';
import { useT } from '../../i18n';
import { errorMessage } from '../logic/errors';
import { Button, Dialog } from './primitives';

export function ErrorDialog() {
  const t = useT();
  const error = useStore((s) => s.connection.error);
  const address = useStore((s) => s.connection.address);
  const dismiss = useCallback(() => {
    const store = useStore.getState();
    const status = store.connection.status;
    store.setConnection({ error: null, status: status === 'error' || status === 'disconnected' ? 'idle' : status });
  }, []);
  if (!error) return null;
  return (
    <Dialog
      title={t('error.title')}
      onClose={dismiss}
      actions={<Button variant="primary" onClick={dismiss} autoFocus>{t('common.dismiss')}</Button>}
    >
      <p data-testid="error-message">{errorMessage(t, error, address)}</p>
      <p className="muted" style={{ marginTop: 8, fontSize: 'var(--fs-0)' }}><span className="code">{error.code}</span></p>
    </Dialog>
  );
}
