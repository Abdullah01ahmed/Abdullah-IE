import { useEffect, useState } from 'react';
import { getMapOrDefault } from '@tra/shared';
import { useStore } from '../../state/store';
import { bi, useLang, useT, type TKey } from '../../i18n';
import { TIP_COUNT, TIP_INTERVAL_MS } from '../logic/constants';
import { Progress } from '../components/primitives';

export function LoadingScreen() {
  const t = useT();
  const lang = useLang();
  const mapId = useStore((s) => s.match?.mapId ?? s.room?.settings.mapId ?? '');
  const loading = useStore((s) => s.loading);
  const map = getMapOrDefault(mapId);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIP_COUNT));

  useEffect(() => {
    const id = setInterval(() => setTip((i) => (i + 1) % TIP_COUNT), TIP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const pct = Math.round(Math.min(1, Math.max(0, loading.progress)) * 100);
  const label = loading.label === 'Ready' ? t('loading.ready') : loading.label || t('loading.preparing');

  return (
    <div
      className="loading"
      data-testid="screen-loading"
      style={{
        ['--map-primary' as string]: map.palette.primary,
        ['--map-secondary' as string]: map.palette.secondary,
        ['--map-accent' as string]: map.palette.accent,
      }}
    >
      <div className="loading__map">
        <span className="loading__kicker">{t('loading.title')} · {bi(lang, map.location, map.locationAr)}</span>
        <h1 className="loading__name">
          <span>{bi(lang, map.name, map.nameAr)}</span>
          <span className="loading__name-alt">{bi(lang, map.nameAr, map.name)}</span>
        </h1>
        <p className="loading__desc">{bi(lang, map.description, map.descriptionAr)}</p>
      </div>
      <div className="loading__bar">
        <div className="loading__label">
          <span>{label}</span>
          <span className="num">{pct}%</span>
        </div>
        <Progress value={loading.progress} />
      </div>
      <div className="loading__tip" key={tip}>
        <span className="loading__tip-label">{t('loading.tip')}</span>
        <span>{t(`tip.${tip}` as TKey)}</span>
      </div>
    </div>
  );
}
