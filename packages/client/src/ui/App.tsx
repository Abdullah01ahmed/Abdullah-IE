/**
 * Root component: routes store.screen to a screen component, keeps the game
 * canvas mounted for in-game screens, installs the match key handling and
 * mirrors the language setting onto <html lang/dir>.
 */
import { useEffect } from 'react';
import '../styles/index.css';
import { applyDocumentLanguage, useStore, type Screen } from '../state/store';
import { exposeDevtools } from './devtools';
import { useMatchKeys } from './hooks/useMatchKeys';
import { GameCanvas } from './components/GameCanvas';
import { MainMenu } from './screens/MainMenu';
import { HostScreen } from './screens/HostScreen';
import { JoinScreen } from './screens/JoinScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { LoadingScreen } from './screens/LoadingScreen';
import { MatchScreen } from './screens/MatchScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LoadoutScreen } from './screens/LoadoutScreen';

exposeDevtools();

const IN_GAME: ReadonlySet<Screen> = new Set<Screen>(['loading', 'match', 'results']);

function ScreenRouter({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'menu':
      return <MainMenu />;
    case 'host':
      return <HostScreen />;
    case 'join':
      return <JoinScreen />;
    case 'lobby':
      return <LobbyScreen />;
    case 'loading':
      return <LoadingScreen />;
    case 'match':
      return <MatchScreen />;
    case 'results':
      return <ResultsScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'loadout':
      return <LoadoutScreen />;
  }
}

export function App() {
  const screen = useStore((s) => s.screen);
  const language = useStore((s) => s.settings.language);
  useEffect(() => applyDocumentLanguage(language), [language]);
  useMatchKeys();
  return (
    <div className="app" data-screen={screen}>
      {IN_GAME.has(screen) && <GameCanvas />}
      <ScreenRouter screen={screen} />
    </div>
  );
}
