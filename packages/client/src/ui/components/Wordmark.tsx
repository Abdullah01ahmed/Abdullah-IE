/** Bilingual CSS wordmark: "TWIN RIVERS: ARENA" / "ساحة الرافدين". No image assets. */
import { IconStar8 } from './icons';

export function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  return (
    <div className={`wordmark wordmark--${size}`} role="img" aria-label="Twin Rivers: Arena — ساحة الرافدين">
      <div className="wordmark__rule"><IconStar8 size={14} /></div>
      <div className="wordmark__en" aria-hidden="true">
        Twin Rivers<em>:</em> Arena
      </div>
      <div className="wordmark__ar" aria-hidden="true">ساحة الرافدين</div>
      <div className="wordmark__rule"><IconStar8 size={14} /></div>
    </div>
  );
}
