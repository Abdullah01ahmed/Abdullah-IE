import { useEffect, useState } from 'react';

/** True while the document holds a pointer lock (tracked via pointerlockchange). */
export function usePointerLock(): boolean {
  const [locked, setLocked] = useState(() => !!document.pointerLockElement);
  useEffect(() => {
    const update = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', update);
    document.addEventListener('pointerlockerror', update);
    update();
    return () => {
      document.removeEventListener('pointerlockchange', update);
      document.removeEventListener('pointerlockerror', update);
    };
  }, []);
  return locked;
}
