/** Esc menu during a match: Resume / Settings (embedded) / Leave match (confirmed). */
import { useState } from 'react';
import { session } from '../../session/Session';
import { useT } from '../../i18n';
import { togglePause } from '../hooks/useMatchKeys';
import { Button, ConfirmDialog } from '../components/primitives';
import { IconChevronBack } from '../components/icons';
import { SettingsPanel } from '../screens/SettingsPanel';

export function PauseMenu() {
  const t = useT();
  const [view, setView] = useState<'menu' | 'settings'>('menu');
  const [confirmLeave, setConfirmLeave] = useState(false);

  return (
    <div className="overlay overlay--dim interactive" data-testid="pause-menu">
      {view === 'menu' ? (
        <div className="panel panel--glass pause">
          <h2 className="pause__title">{t('pause.title')}</h2>
          <p className="pause__sub">{t('pause.subtitle')}</p>
          <nav className="pause__nav">
            <button type="button" className="menu-btn menu-btn--primary" onClick={togglePause} autoFocus data-testid="pause-resume">{t('pause.resume')}</button>
            <button type="button" className="menu-btn" onClick={() => setView('settings')} data-testid="pause-settings">{t('pause.settings')}</button>
            <button type="button" className="menu-btn" onClick={() => setConfirmLeave(true)} data-testid="pause-leave">{t('pause.leave')}</button>
          </nav>
        </div>
      ) : (
        <div className="panel panel--glass pause pause--wide">
          <div className="row row--between" style={{ marginBottom: 12 }}>
            <Button variant="ghost" icon={<IconChevronBack size={18} />} onClick={() => setView('menu')}>{t('common.back')}</Button>
            <h2 className="pause__title" style={{ fontSize: 'var(--fs-4)' }}>{t('settings.title')}</h2>
          </div>
          <SettingsPanel />
        </div>
      )}

      {confirmLeave && (
        <ConfirmDialog
          title={t('pause.leaveConfirmTitle')}
          body={session.isHosting ? t('pause.leaveConfirmHost') : t('pause.leaveConfirm')}
          confirmLabel={t('pause.leave')}
          danger
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => { setConfirmLeave(false); void session.leave(); }}
        />
      )}
    </div>
  );
}
