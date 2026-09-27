import { useStore } from '../../state/store';
import { useT } from '../../i18n';
import { ScreenFrame } from '../components/ScreenFrame';
import { Panel } from '../components/primitives';
import { SettingsPanel } from './SettingsPanel';

/** Full-screen settings (from the main menu or the lobby). The pause menu embeds SettingsPanel directly. */
export function SettingsScreen() {
  const t = useT();
  const goBack = useStore((s) => s.goBack);
  return (
    <ScreenFrame title={t('settings.title')} onBack={goBack} width="medium" testId="screen-settings">
      <Panel>
        <SettingsPanel />
      </Panel>
    </ScreenFrame>
  );
}
