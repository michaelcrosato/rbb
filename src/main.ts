import './styles.css';
import { Game } from './client/game';

const root = document.querySelector<HTMLElement>('#app')!;
try {
  const game = new Game(root);
  if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') {
    // Read-only copies support AI navigation and bug reports, never state mutation.
    Object.defineProperty(window, 'rbbDiagnostics', {
      value: () => game.diagnostics(),
      configurable: true,
    });
  }
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
} catch (error) {
  console.error('Unable to start RBB:', error);
  const fatal = root.querySelector<HTMLElement>('#fatal');
  if (fatal) {
    fatal.hidden = false;
    fatal.textContent =
      'RBB could not start its WebGL 2 renderer. Enable hardware acceleration, update your browser, then reload. Existing saves have not been changed.';
  } else root.textContent = 'RBB could not start. Please update your browser and reload.';
}
