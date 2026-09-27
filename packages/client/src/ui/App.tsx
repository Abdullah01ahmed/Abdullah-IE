/**
 * PLACEHOLDER shell — replaced by the full UI. Keeps the app compiling so the
 * session/game layers can be exercised.
 */
import { useStore } from '../state/store';

export function App() {
  const screen = useStore((s) => s.screen);
  return (
    <div style={{ color: '#fff', background: '#111', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Twin Rivers: Arena</h1>
      <p>UI pending — current screen: {screen}</p>
    </div>
  );
}
