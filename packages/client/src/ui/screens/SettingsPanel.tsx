/**
 * Settings editor with Graphics / Audio / Controls / Interface tabs. Used as a
 * full screen (SettingsScreen) and embedded in the pause menu. Every change
 * goes through store.updateSettings, which persists via the desktop bridge.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../../state/store';
import {
  GAME_ACTIONS,
  GRAPHICS_PRESETS,
  applyGraphicsPreset,
  detectPreset,
  type ClientSettings,
  type GameAction,
  type GraphicsPreset,
  type GraphicsSettings,
  type Language,
  type Quality3,
  type ShadowQuality,
} from '../../state/settings';
import { LANGUAGES, LANGUAGE_NAMES, useT, type TKey } from '../../i18n';
import {
  MAX_BINDINGS_PER_ACTION,
  bindingFromKeyboard,
  bindingFromMouse,
  bindingFromWheel,
  bindingLabel,
  findDuplicateBindings,
  isCancelKey,
  removeBinding,
  resetBindings,
  setBinding,
} from '../logic/bindings';
import { Button, Notice, Segmented, Select, Slider, Tabs, Toggle } from '../components/primitives';
import { IconWarning, IconX } from '../components/icons';

export type SettingsTab = 'graphics' | 'audio' | 'controls' | 'interface';
const TABS: readonly SettingsTab[] = ['graphics', 'audio', 'controls', 'interface'];

export function SettingsPanel({ initialTab = 'graphics' }: { initialTab?: SettingsTab }) {
  const t = useT();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return (
    <div className="settings-layout" data-testid="settings-panel">
      <Tabs<SettingsTab> value={tab} onChange={setTab} tabs={TABS.map((id) => ({ id, label: t(`settings.tab.${id}` as TKey) }))} />
      <div className="settings-tabpanel" role="tabpanel">
        {tab === 'graphics' && <GraphicsTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'controls' && <ControlsTab />}
        {tab === 'interface' && <InterfaceTab />}
      </div>
    </div>
  );
}

function Row({ label, note, htmlFor, children }: { label: ReactNode; note?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <label className="settings-row__label" htmlFor={htmlFor}>
        <span>{label}</span>
        {note && <span className="settings-row__note">{note}</span>}
      </label>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function useSettingsUpdater() {
  return useStore((s) => s.updateSettings);
}

// ---- Graphics ---------------------------------------------------------------

const PRESETS = Object.keys(GRAPHICS_PRESETS) as Exclude<GraphicsPreset, 'custom'>[];
const SHADOWS: readonly ShadowQuality[] = ['off', 'low', 'medium', 'high', 'ultra'];
const Q3: readonly Quality3[] = ['low', 'medium', 'high'];
const MSAA = [0, 2, 4, 8] as const;
const ANISO = [1, 4, 8, 16] as const;
const MAX_FPS = [0, 30, 60, 120, 144, 165, 240, 360];

function GraphicsTab() {
  const t = useT();
  const g = useStore((s) => s.settings.graphics);
  const update = useSettingsUpdater();
  const setGraphics = (patch: Partial<GraphicsSettings>) =>
    update((s) => {
      const next = { ...s.graphics, ...patch };
      return { ...s, graphics: { ...next, preset: detectPreset(next) } };
    });
  const setPreset = (preset: GraphicsPreset) => update((s) => ({ ...s, graphics: applyGraphicsPreset(s.graphics, preset) }));
  const qualityLabel = (q: string) => t(`quality.${q}` as TKey);

  return (
    <>
      <Row label={t('settings.graphics.preset')}>
        <Segmented<GraphicsPreset>
          value={g.preset}
          onChange={setPreset}
          options={[...PRESETS.map((p) => ({ value: p, label: t(`preset.${p}` as TKey) })), { value: 'custom' as const, label: t('preset.custom'), disabled: true }]}
        />
      </Row>
      <Row label={t('settings.graphics.renderScale')}>
        <Slider value={g.renderScale} min={0.5} max={1.5} step={0.05} onChange={(renderScale) => setGraphics({ renderScale: Math.round(renderScale * 100) / 100 })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label={t('settings.graphics.shadows')}>
        <Select<ShadowQuality> value={g.shadows} options={SHADOWS.map((v) => ({ value: v, label: qualityLabel(v) }))} onChange={(shadows) => setGraphics({ shadows })} aria-label={t('settings.graphics.shadows')} />
      </Row>
      <Row label={t('settings.graphics.ssao')}>
        <Toggle checked={g.ssao} onChange={(ssao) => setGraphics({ ssao })} aria-label={t('settings.graphics.ssao')} />
      </Row>
      <Row label={t('settings.graphics.bloom')}>
        <Toggle checked={g.bloom} onChange={(bloom) => setGraphics({ bloom })} aria-label={t('settings.graphics.bloom')} />
      </Row>
      <Row label={t('settings.graphics.fxaa')}>
        <Toggle checked={g.fxaa} onChange={(fxaa) => setGraphics({ fxaa })} aria-label={t('settings.graphics.fxaa')} />
      </Row>
      <Row label={t('settings.graphics.msaa')} note={t('settings.restartNote')}>
        <Select<number> value={g.msaa} options={MSAA.map((v) => ({ value: v, label: v === 0 ? t('quality.off') : `${v}×` }))} onChange={(v) => setGraphics({ msaa: v as GraphicsSettings['msaa'] })} aria-label={t('settings.graphics.msaa')} />
      </Row>
      <Row label={t('settings.graphics.textureQuality')}>
        <Select<Quality3> value={g.textureQuality} options={Q3.map((v) => ({ value: v, label: qualityLabel(v) }))} onChange={(textureQuality) => setGraphics({ textureQuality })} aria-label={t('settings.graphics.textureQuality')} />
      </Row>
      <Row label={t('settings.graphics.particles')}>
        <Select<Quality3> value={g.particles} options={Q3.map((v) => ({ value: v, label: qualityLabel(v) }))} onChange={(particles) => setGraphics({ particles })} aria-label={t('settings.graphics.particles')} />
      </Row>
      <Row label={t('settings.graphics.anisotropy')}>
        <Select<number> value={g.anisotropy} options={ANISO.map((v) => ({ value: v, label: v === 1 ? t('quality.off') : `${v}×` }))} onChange={(v) => setGraphics({ anisotropy: v as GraphicsSettings['anisotropy'] })} aria-label={t('settings.graphics.anisotropy')} />
      </Row>
      <Row label={t('settings.graphics.fov')}>
        <Slider value={g.fov} min={60} max={120} step={1} onChange={(fov) => setGraphics({ fov })} format={(v) => `${v}°`} />
      </Row>
      <Row label={t('settings.graphics.vsync')}>
        <Toggle checked={g.vsync} onChange={(vsync) => setGraphics({ vsync })} aria-label={t('settings.graphics.vsync')} />
      </Row>
      <Row label={t('settings.graphics.maxFps')}>
        <Select<number> value={MAX_FPS.includes(g.maxFps) ? g.maxFps : 0} options={MAX_FPS.map((v) => ({ value: v, label: v === 0 ? t('common.unlimited') : String(v) }))} onChange={(maxFps) => setGraphics({ maxFps })} aria-label={t('settings.graphics.maxFps')} />
      </Row>
      <Row label={t('settings.graphics.reduceShake')}>
        <Toggle checked={g.reduceCameraShake} onChange={(reduceCameraShake) => setGraphics({ reduceCameraShake })} aria-label={t('settings.graphics.reduceShake')} />
      </Row>
      <Row label={t('settings.graphics.showFps')}>
        <Toggle checked={g.showFps} onChange={(showFps) => setGraphics({ showFps })} aria-label={t('settings.graphics.showFps')} />
      </Row>
      <Row label={t('settings.graphics.webgpu')} note={t('settings.restartNote')}>
        <Toggle checked={g.webgpu} onChange={(webgpu) => setGraphics({ webgpu })} aria-label={t('settings.graphics.webgpu')} />
      </Row>
    </>
  );
}

// ---- Audio ------------------------------------------------------------------

const AUDIO_CHANNELS = ['master', 'effects', 'music', 'ui', 'announcer'] as const;

function AudioTab() {
  const t = useT();
  const audio = useStore((s) => s.settings.audio);
  const update = useSettingsUpdater();
  return (
    <>
      {AUDIO_CHANNELS.map((ch) => (
        <Row key={ch} label={t(`settings.audio.${ch}` as TKey)}>
          <Slider value={audio[ch]} min={0} max={1} step={0.01} onChange={(v) => update((s) => ({ ...s, audio: { ...s.audio, [ch]: v } }))} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
      ))}
    </>
  );
}

// ---- Controls ----------------------------------------------------------------

interface Capture {
  action: GameAction;
  slot: number;
}

function ControlsTab() {
  const t = useT();
  const controls = useStore((s) => s.settings.controls);
  const update = useSettingsUpdater();
  const setControls = (patch: Partial<ClientSettings['controls']>) => update((s) => ({ ...s, controls: { ...s.controls, ...patch } }));
  const [capture, setCapture] = useState<Capture | null>(null);

  // While capturing, the next key / mouse button / wheel notch becomes the binding.
  useEffect(() => {
    if (!capture) return;
    const assign = (code: string | null) => {
      if (code) update((s) => ({ ...s, controls: { ...s.controls, bindings: setBinding(s.controls.bindings, capture.action, capture.slot, code) } }));
      setCapture(null);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isCancelKey(e.code)) setCapture(null);
      else assign(bindingFromKeyboard(e));
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      assign(bindingFromMouse(e.button));
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      assign(bindingFromWheel(e.deltaY));
    };
    const onContext = (e: Event) => e.preventDefault();
    const onBlur = () => setCapture(null);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('contextmenu', onContext, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [capture, update]);

  const duplicates = findDuplicateBindings(controls.bindings);
  const label = (code: string) => {
    const l = bindingLabel(code);
    return 'key' in l ? t(l.key) : l.text;
  };

  return (
    <>
      <Row label={t('settings.controls.sensitivity')}>
        <Slider value={controls.sensitivity} min={0.1} max={30} step={0.1} onChange={(v) => setControls({ sensitivity: Math.round(v * 10) / 10 })} format={(v) => v.toFixed(1)} />
      </Row>
      <Row label={t('settings.controls.adsMult')}>
        <Slider value={controls.adsSensitivityMult} min={0.1} max={3} step={0.05} onChange={(v) => setControls({ adsSensitivityMult: Math.round(v * 100) / 100 })} format={(v) => `${v.toFixed(2)}×`} />
      </Row>
      <Row label={t('settings.controls.invertY')}>
        <Toggle checked={controls.invertY} onChange={(invertY) => setControls({ invertY })} aria-label={t('settings.controls.invertY')} />
      </Row>
      <Row label={t('settings.controls.toggleAds')}>
        <Toggle checked={controls.toggleAds} onChange={(toggleAds) => setControls({ toggleAds })} aria-label={t('settings.controls.toggleAds')} />
      </Row>
      <Row label={t('settings.controls.toggleCrouch')}>
        <Toggle checked={controls.toggleCrouch} onChange={(toggleCrouch) => setControls({ toggleCrouch })} aria-label={t('settings.controls.toggleCrouch')} />
      </Row>
      <Row label={t('settings.controls.toggleSprint')}>
        <Toggle checked={controls.toggleSprint} onChange={(toggleSprint) => setControls({ toggleSprint })} aria-label={t('settings.controls.toggleSprint')} />
      </Row>

      <h4 className="section-title">{t('settings.controls.bindings')}</h4>
      <p className="field__hint">{t('settings.controls.bindingsHint')}</p>
      {capture && (
        <Notice tone="brass" title={t('settings.controls.pressKey')}>{t('settings.controls.pressKeyHint')}</Notice>
      )}
      {duplicates.size > 0 && (
        <Notice tone="danger" icon={<IconWarning />}>
          {t('settings.controls.duplicate', {
            keys: [...duplicates.entries()].map(([code, actions]) => `${label(code)} (${actions.map((a) => t(`action.${a}` as TKey)).join(', ')})`).join('; '),
          })}
        </Notice>
      )}
      <table className="bindings">
        <tbody>
          {GAME_ACTIONS.map((action) => {
            const codes = controls.bindings[action];
            return (
              <tr key={action}>
                <td className="bindings__action">{t(`action.${action}` as TKey)}</td>
                <td>
                  <div className="bindings__keys">
                    {codes.map((code, slot) => {
                      const capturing = capture?.action === action && capture.slot === slot;
                      return (
                        <span key={`${code}-${slot}`} className={`key-chip${capturing ? ' key-chip--capturing' : ''}${duplicates.has(code) ? ' key-chip--dup' : ''}`}>
                          <button type="button" onClick={() => setCapture({ action, slot })} aria-label={`${t(`action.${action}` as TKey)}: ${label(code)}`}>
                            {capturing ? t('settings.controls.pressKey') : label(code)}
                          </button>
                          <button type="button" className="key-chip__x" title={t('settings.controls.removeBinding')} aria-label={t('settings.controls.removeBinding')} onClick={() => setControls({ bindings: removeBinding(controls.bindings, action, slot) })}>
                            <IconX size={12} />
                          </button>
                        </span>
                      );
                    })}
                    {codes.length < MAX_BINDINGS_PER_ACTION && (
                      <button type="button" className={`key-chip key-chip--add${capture?.action === action && capture.slot >= codes.length ? ' key-chip--capturing' : ''}`} onClick={() => setCapture({ action, slot: codes.length })}>
                        {capture?.action === action && capture.slot >= codes.length ? t('settings.controls.pressKey') : `+ ${t('settings.controls.addBinding')}`}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row row--end" style={{ marginTop: 14 }}>
        <Button variant="ghost" onClick={() => setControls({ bindings: resetBindings() })}>{t('settings.controls.resetBindings')}</Button>
      </div>
    </>
  );
}

// ---- Interface -----------------------------------------------------------------

function InterfaceTab() {
  const t = useT();
  const language = useStore((s) => s.settings.language);
  const showFps = useStore((s) => s.settings.graphics.showFps);
  const update = useSettingsUpdater();
  return (
    <>
      <Row label={t('settings.interface.language')} note={t('settings.interface.languageHint')}>
        <Segmented<Language>
          value={language}
          onChange={(lang) => update((s) => ({ ...s, language: lang }))}
          options={LANGUAGES.map((l) => ({ value: l, label: <span lang={l}>{LANGUAGE_NAMES[l]}</span> }))}
          aria-label={t('settings.interface.language')}
        />
      </Row>
      <Row label={t('settings.graphics.showFps')}>
        <Toggle checked={showFps} onChange={(v) => update((s) => ({ ...s, graphics: { ...s.graphics, showFps: v } }))} aria-label={t('settings.graphics.showFps')} />
      </Row>
    </>
  );
}
