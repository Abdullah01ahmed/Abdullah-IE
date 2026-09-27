import { useState } from 'react';
import { GAME_VERSION, MAX_NAME_LENGTH } from '@tra/shared';
import { useStore } from '../../state/store';
import type { Language } from '../../state/settings';
import { getBridge } from '../../platform/bridge';
import { LANGUAGES, LANGUAGE_NAMES, useT } from '../../i18n';
import { Backdrop } from '../components/Backdrop';
import { Wordmark } from '../components/Wordmark';
import { ErrorDialog } from '../components/ErrorDialog';
import { Field, TextInput } from '../components/primitives';
import { IconChevronForward } from '../components/icons';

export function MainMenu() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const setScreen = useStore((s) => s.setScreen);
  const updateSettings = useStore((s) => s.updateSettings);
  const [name, setName] = useState(settings.playerName);
  const bridge = getBridge();

  /** Persist the name (trimmed) if it changed; navigation calls this first. */
  const commitName = () => {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    if (trimmed !== settings.playerName) updateSettings((s) => ({ ...s, playerName: trimmed }));
    if (trimmed !== name) setName(trimmed);
  };
  const go = (screen: 'host' | 'join' | 'loadout' | 'settings') => {
    commitName();
    setScreen(screen);
  };
  const setLanguage = (language: Language) => updateSettings((s) => ({ ...s, language }));

  return (
    <div className="screen" data-testid="screen-menu">
      <Backdrop />
      <div className="menu" style={{ position: 'relative', zIndex: 1 }}>
        <div className="menu__brand">
          <Wordmark size="lg" />
          <p className="menu__tag">{t('menu.tagline')}</p>
        </div>

        <nav className="panel panel--glass menu__nav" aria-label="Main menu">
          <Field label={t('menu.playerName')} hint={t('menu.nameHint')} htmlFor="menu-name">
            <TextInput
              id="menu-name"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              placeholder={t('menu.playerNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && commitName()}
            />
          </Field>
          <div>
            <button type="button" className="menu-btn menu-btn--primary" onClick={() => go('host')} data-testid="menu-host">
              {t('menu.host')} <IconChevronForward size={18} />
            </button>
            <button type="button" className="menu-btn" onClick={() => go('join')} data-testid="menu-join">
              {t('menu.join')} <IconChevronForward size={18} />
            </button>
            <button type="button" className="menu-btn" onClick={() => go('loadout')} data-testid="menu-loadout">
              {t('menu.loadout')}
            </button>
            <button type="button" className="menu-btn" onClick={() => go('settings')} data-testid="menu-settings">
              {t('menu.settings')}
            </button>
            {bridge.isElectron && (
              <button type="button" className="menu-btn" onClick={() => { commitName(); void bridge.quit(); }} data-testid="menu-quit">
                {t('menu.quit')}
              </button>
            )}
          </div>
        </nav>
      </div>

      <footer className="menu__footer" style={{ zIndex: 1 }}>
        <span className="ltr">{t('common.version', { version: bridge.version || GAME_VERSION })}</span>
        <div className="lang-switch" role="group" aria-label={t('common.language')}>
          {LANGUAGES.map((lang) => (
            <button key={lang} type="button" className="lang-switch__opt" aria-pressed={settings.language === lang} onClick={() => setLanguage(lang)} lang={lang}>
              {LANGUAGE_NAMES[lang]}
            </button>
          ))}
        </div>
      </footer>

      <ErrorDialog />
    </div>
  );
}
