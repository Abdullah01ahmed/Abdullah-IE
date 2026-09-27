import { useEffect, useState } from 'react';
import { WEAPONS, WEAPON_IDS, type Loadout, type WeaponId } from '@tra/shared';
import { useStore } from '../../state/store';
import { session } from '../../session/Session';
import { bi, useLang, useT, type TKey } from '../../i18n';
import { weaponStats } from '../logic/weaponStats';
import { ScreenFrame } from '../components/ScreenFrame';
import { Badge, Button, CardCheck, StatBar } from '../components/primitives';
import { WeaponGlyph } from '../components/icons';

type Slot = keyof Loadout;

export function LoadoutScreen() {
  const t = useT();
  const lang = useLang();
  const saved = useStore((s) => s.loadout);
  const goBack = useStore((s) => s.goBack);
  const [draft, setDraft] = useState<Loadout>(saved);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!savedFlash) return;
    const id = setTimeout(() => setSavedFlash(false), 1800);
    return () => clearTimeout(id);
  }, [savedFlash]);

  /** Picking the weapon already in the other slot swaps the two, so the pair is always distinct. */
  const pick = (slot: Slot, id: WeaponId) => {
    setDraft((d) => {
      const other: Slot = slot === 'primary' ? 'secondary' : 'primary';
      if (d[other] === id) return { primary: d.secondary, secondary: d.primary };
      return { ...d, [slot]: id };
    });
  };

  const dirty = draft.primary !== saved.primary || draft.secondary !== saved.secondary;
  const save = () => {
    // Works offline too: setLoadout updates the store and only sends when connected.
    session.setLoadout(draft);
    setSavedFlash(true);
  };

  return (
    <ScreenFrame
      title={t('loadout.title')}
      subtitle={t('loadout.subtitle')}
      onBack={goBack}
      width="medium"
      testId="screen-loadout"
      footer={
        <>
          <span className={savedFlash ? 'loadout__saved' : 'muted'}>{savedFlash ? t('loadout.saved') : ''}</span>
          <Button variant="primary" size="lg" disabled={!dirty && !savedFlash} onClick={save} data-testid="loadout-save">{t('loadout.save')}</Button>
        </>
      }
    >
      <div className="loadout">
        {(['primary', 'secondary'] as const).map((slot) => (
          <section key={slot}>
            <h3 className="loadout__slot-title">
              {t(slot === 'primary' ? 'loadout.primary' : 'loadout.secondary')}
              <Badge tone="brass">{t('hud.weaponSlot', { n: slot === 'primary' ? 1 : 2 })}</Badge>
            </h3>
            <div className="stack">
              {WEAPON_IDS.map((id) => {
                const def = WEAPONS[id];
                const selected = draft[slot] === id;
                return (
                  <button key={id} type="button" className="card weapon-card" aria-pressed={selected} onClick={() => pick(slot, id)} data-testid={`weapon-${slot}-${id}`}>
                    <div className="weapon-card__head">
                      <span className="card__title weapon-card__name">{bi(lang, def.name, def.nameAr)}</span>
                      <span className="weapon-card__alt">{bi(lang, def.nameAr, def.name)}</span>
                    </div>
                    <div className="row">
                      <Badge>{t(`weaponClass.${def.cls}` as TKey)}</Badge>
                      {selected && <Badge tone="brass">{t('loadout.equipped')}</Badge>}
                    </div>
                    <div className="weapon-card__silhouette"><WeaponGlyph weapon={id} size={64} /></div>
                    <p className="card__desc">{t(`weapon.${id}.desc` as TKey)}</p>
                    <div className="weapon-card__stats">
                      {weaponStats(def).map((s) => (
                        <StatBar key={s.key} label={t(s.key)} value={s.value} display={s.display} />
                      ))}
                    </div>
                    <div className="weapon-card__meta">
                      <span>{t('loadout.rpm', { n: def.rpm })}</span>
                      <span>{t('loadout.mag', { mag: def.magSize, reserve: def.reserve })}</span>
                    </div>
                    <CardCheck />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </ScreenFrame>
  );
}
