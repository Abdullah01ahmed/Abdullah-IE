/** The in-match layer stack: HUD, then hold-Tab scoreboard, pointer-lock prompt and pause menu. */
import { useStore } from '../../state/store';
import { usePointerLock } from '../hooks/usePointerLock';
import { Hud } from '../hud/Hud';
import { PauseMenu } from '../overlays/PauseMenu';
import { ScoreboardOverlay } from '../overlays/ScoreboardOverlay';
import { ResumeOverlay } from '../overlays/ResumeOverlay';

export function MatchScreen() {
  const paused = useStore((s) => s.paused);
  const scoreboardOpen = useStore((s) => s.scoreboardOpen);
  const chatOpen = useStore((s) => s.chatOpen);
  const locked = usePointerLock();
  return (
    <div data-testid="screen-match" style={{ position: 'absolute', inset: 0 }}>
      <Hud />
      {scoreboardOpen && !paused && <ScoreboardOverlay />}
      {!locked && !paused && !chatOpen && <ResumeOverlay />}
      {paused && <PauseMenu />}
    </div>
  );
}
