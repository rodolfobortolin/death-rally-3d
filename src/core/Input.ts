/** Normalized driving input, independent from the physical device or the AI. */
export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (also reverse when stopped)
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  boost: boolean;
  fire: boolean;
  dropMine: boolean;
}

export const NEUTRAL_INPUT: Readonly<DriveInput> = Object.freeze({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
  fire: false,
  dropMine: false,
});

/** Keyboard input handler with edge-triggered "pressed" detection for actions. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressedThisFrame.has(c));
  }

  /** Must be called once at the end of every frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  getDriveInput(): DriveInput {
    const left = this.isDown('KeyA', 'ArrowLeft') ? 1 : 0;
    const right = this.isDown('KeyD', 'ArrowRight') ? 1 : 0;
    return {
      throttle: this.isDown('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.isDown('KeyS', 'ArrowDown') ? 1 : 0,
      steer: right - left,
      handbrake: this.isDown('Space'),
      boost: this.isDown('ShiftLeft', 'ShiftRight', 'KeyL'),
      fire: this.isDown('KeyJ', 'KeyZ'),
      dropMine: this.wasPressed('KeyK', 'KeyX'),
    };
  }
}
