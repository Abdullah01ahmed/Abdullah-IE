/** Shared chrome for menu-side screens: back button, title, small wordmark, scrollable body. */
import type { ReactNode } from 'react';
import { useT } from '../../i18n';
import { Button } from './primitives';
import { IconChevronBack } from './icons';
import { Wordmark } from './Wordmark';

export interface ScreenFrameProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?(): void;
  width?: 'narrow' | 'medium' | 'wide';
  footer?: ReactNode;
  /** Extra controls on the title bar. */
  actions?: ReactNode;
  testId?: string;
  children: ReactNode;
}

export function ScreenFrame({ title, subtitle, onBack, width = 'wide', footer, actions, testId, children }: ScreenFrameProps) {
  const t = useT();
  return (
    <div className="screen" data-testid={testId}>
      <header className="screen__bar">
        {onBack && (
          <Button variant="ghost" onClick={onBack} icon={<IconChevronBack size={18} />}>{t('common.back')}</Button>
        )}
        <div>
          <h1 className="screen__title">{title}</h1>
          {subtitle && <p className="screen__subtitle">{subtitle}</p>}
        </div>
        <span className="spacer" />
        {actions}
        <Wordmark size="sm" />
      </header>
      <div className="screen__body">
        <div className={`screen__content${width !== 'wide' ? ` screen__content--${width}` : ''}`}>{children}</div>
      </div>
      {footer && <footer className="screen__footer">{footer}</footer>}
    </div>
  );
}
