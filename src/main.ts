import { Game } from './core/Game';

const container = document.getElementById('app')!;
const game = new Game(container);
game.start();

// Exposed for debugging from the browser console.
(window as unknown as { game: Game }).game = game;
