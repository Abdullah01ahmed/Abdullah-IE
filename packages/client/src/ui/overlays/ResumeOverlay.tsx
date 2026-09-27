/** Shown when the pointer lock is lost mid-match (not paused): a click re-acquires it. */
import { session } from '../../session/Session';
import { useT } from '../../i18n';
import { IconMouse } from '../components/icons';

export function ResumeOverlay() {
  const t = useT();
  return (
    <div className="overlay overlay--resume interactive" onClick={() => session.game.requestPointerLock()} data-testid="resume-overlay">
      <div className="panel panel--glass resume-card">
        <IconMouse size={28} className="text-team" />
        <span className="resume-card__title">{t('hud.clickToResume')}</span>
        <span className="resume-card__hint">{t('hud.clickHint')}</span>
      </div>
    </div>
  );
}
