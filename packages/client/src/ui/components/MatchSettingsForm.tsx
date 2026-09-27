/**
 * Match settings editor used by the Host screen (local draft) and the Lobby
 * (host edits are sent to the server; everyone else sees it read-only).
 */
import {
  AVAILABLE_MODES,
  BOT_DIFFICULTIES,
  GAME_MODE_NAMES,
  SETTINGS_LIMITS,
  TEAM_SIZE,
  listPlayableMaps,
  type BotDifficultyId,
  type BotFillMode,
  type GameModeId,
  type MatchSettings,
} from '@tra/shared';
import { bi, useLang, useT, type TKey } from '../../i18n';
import { CardCheck, Field, NumberStepper, Segmented, Slider, Toggle } from './primitives';

const ALL_MODES: readonly GameModeId[] = ['tdm', 'dom', 'hp', 'kc'];
const BOT_MODES: readonly BotFillMode[] = ['none', 'fixed', 'fill'];

export interface MatchSettingsFormProps {
  value: MatchSettings;
  onChange(patch: Partial<MatchSettings>): void;
  readOnly?: boolean;
}

export function MatchSettingsForm({ value, onChange, readOnly = false }: MatchSettingsFormProps) {
  const t = useT();
  const lang = useLang();
  const maps = listPlayableMaps();
  const bots = value.bots;
  const setBots = (patch: Partial<MatchSettings['bots']>) => onChange({ bots: { ...bots, ...patch } });

  return (
    <div className="stack">
      {readOnly && <p className="field__hint">{t('settingsForm.readOnly')}</p>}

      <h4 className="section-title">{t('settingsForm.map')}</h4>
      <div className="map-grid" role="radiogroup" aria-label={t('settingsForm.map')}>
        {maps.map((m) => (
          <button
            key={m.id}
            type="button"
            className="card"
            role="radio"
            aria-checked={value.mapId === m.id}
            aria-pressed={value.mapId === m.id}
            disabled={readOnly}
            onClick={() => value.mapId !== m.id && onChange({ mapId: m.id, mapRotation: [m.id] })}
          >
            <div
              className="map-card__art"
              style={{
                ['--map-primary' as string]: m.palette.primary,
                ['--map-secondary' as string]: m.palette.secondary,
                ['--map-accent' as string]: m.palette.accent,
              }}
            />
            <div className="card__title">{bi(lang, m.name, m.nameAr)} <span className="card__sub">{bi(lang, m.nameAr, m.name)}</span></div>
            <div className="card__sub">{bi(lang, m.location, m.locationAr)}</div>
            <div className="card__desc">{bi(lang, m.description, m.descriptionAr)}</div>
            <CardCheck />
          </button>
        ))}
      </div>

      <h4 className="section-title">{t('settingsForm.mode')}</h4>
      <Segmented<GameModeId>
        value={value.mode}
        disabled={readOnly}
        aria-label={t('settingsForm.mode')}
        onChange={(mode) => onChange({ mode })}
        options={ALL_MODES.map((id) => ({
          value: id,
          label: bi(lang, GAME_MODE_NAMES[id].en, GAME_MODE_NAMES[id].ar),
          disabled: !AVAILABLE_MODES.includes(id),
          tag: AVAILABLE_MODES.includes(id) ? undefined : t('common.comingSoon'),
        }))}
      />

      <h4 className="section-title">{t('settingsForm.rules')}</h4>
      <div className="form-grid">
        <Field label={t('settingsForm.scoreLimit')}>
          <NumberStepper
            value={value.scoreLimit}
            min={SETTINGS_LIMITS.scoreLimit.min}
            max={SETTINGS_LIMITS.scoreLimit.max}
            step={5}
            disabled={readOnly}
            onChange={(scoreLimit) => onChange({ scoreLimit })}
            aria-label={t('settingsForm.scoreLimit')}
          />
        </Field>
        <Field label={t('settingsForm.timeLimit')}>
          <NumberStepper
            value={Math.round(value.timeLimitSec / 60)}
            min={SETTINGS_LIMITS.timeLimitSec.min / 60}
            max={SETTINGS_LIMITS.timeLimitSec.max / 60}
            unit={t('settingsForm.minutes')}
            disabled={readOnly}
            onChange={(minutes) => onChange({ timeLimitSec: minutes * 60 })}
            aria-label={t('settingsForm.timeLimit')}
          />
        </Field>
        <Field label={t('settingsForm.respawnDelay')} value={t('common.seconds', { n: value.respawnDelaySec })}>
          <Slider
            value={value.respawnDelaySec}
            min={SETTINGS_LIMITS.respawnDelaySec.min}
            max={SETTINGS_LIMITS.respawnDelaySec.max}
            disabled={readOnly}
            onChange={(respawnDelaySec) => onChange({ respawnDelaySec })}
            format={(v) => `${v}`}
          />
        </Field>
        <Field label={t('settingsForm.friendlyFire')} inline>
          <Toggle checked={value.friendlyFire} disabled={readOnly} onChange={(friendlyFire) => onChange({ friendlyFire })} aria-label={t('settingsForm.friendlyFire')} />
        </Field>
      </div>

      <h4 className="section-title">{t('settingsForm.bots')}</h4>
      <div className="stack">
        <Field label={t('settingsForm.botMode')}>
          <Segmented<BotFillMode>
            value={bots.mode}
            disabled={readOnly}
            aria-label={t('settingsForm.botMode')}
            onChange={(mode) => setBots({ mode })}
            options={BOT_MODES.map((m) => ({ value: m, label: t(`settingsForm.botMode.${m}` as TKey) }))}
          />
        </Field>
        {bots.mode === 'fixed' && (
          <div className="form-grid">
            <Field label={<span className="text-tigris">{t('settingsForm.botCount.tigris')}</span>}>
              <NumberStepper value={bots.tigris} min={0} max={TEAM_SIZE} disabled={readOnly} onChange={(tigris) => setBots({ tigris })} aria-label={t('settingsForm.botCount.tigris')} />
            </Field>
            <Field label={<span className="text-euphrates">{t('settingsForm.botCount.euphrates')}</span>}>
              <NumberStepper value={bots.euphrates} min={0} max={TEAM_SIZE} disabled={readOnly} onChange={(euphrates) => setBots({ euphrates })} aria-label={t('settingsForm.botCount.euphrates')} />
            </Field>
          </div>
        )}
        {bots.mode !== 'none' && (
          <>
            <Field label={t('settingsForm.difficulty')}>
              <Segmented<BotDifficultyId>
                value={bots.difficulty}
                disabled={readOnly}
                aria-label={t('settingsForm.difficulty')}
                onChange={(difficulty) => setBots({ difficulty })}
                options={BOT_DIFFICULTIES.map((d) => ({ value: d, label: t(`difficulty.${d}` as TKey) }))}
              />
            </Field>
            <Field label={t('settingsForm.replaceWithHumans')} hint={t('settingsForm.replaceHint')} inline>
              <Toggle checked={bots.replaceWithHumans} disabled={readOnly} onChange={(replaceWithHumans) => setBots({ replaceWithHumans })} aria-label={t('settingsForm.replaceWithHumans')} />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}
