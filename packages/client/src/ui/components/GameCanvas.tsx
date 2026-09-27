/**
 * Hosts the single game <canvas>. The engine attaches to one canvas for the
 * life of the app, so the element is created once (module singleton) and
 * re-parented into whichever GameCanvas instance is mounted. This also makes
 * React StrictMode's double mount harmless: attach() runs exactly once.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../../state/store';
import { session } from '../../session/Session';

let canvasEl: HTMLCanvasElement | null = null;
let attached = false;

function getCanvas(): HTMLCanvasElement {
  if (!canvasEl) {
    canvasEl = document.createElement('canvas');
    canvasEl.id = 'game-canvas';
    canvasEl.tabIndex = -1;
  }
  return canvasEl;
}

export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = getCanvas();
    host.appendChild(canvas);
    if (!attached) {
      attached = true;
      session.game.attach(canvas).catch((err) => {
        attached = false;
        console.error('Failed to attach the game engine', err);
      });
    }
    const onResize = () => session.game.resize();
    window.addEventListener('resize', onResize);
    const raf = requestAnimationFrame(onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      if (canvas.parentElement === host) host.removeChild(canvas);
    };
  }, []);

  const onClick = () => {
    const s = useStore.getState();
    if (s.screen === 'match' && !s.paused && !s.chatOpen) session.game.requestPointerLock();
  };

  return <div ref={hostRef} className="game-canvas-host" onClick={onClick} data-testid="game-canvas" />;
}
