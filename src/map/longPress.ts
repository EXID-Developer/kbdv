const MOVE_TOLERANCE_PX = 10;
const SUPPRESS_MS = 800;

interface LongPressOptions {
  holdMs?: number;
  /** Ignore mouse and pen input. */
  touchOnly?: boolean;
}

/**
 * Detects a one-finger long press. After it fires, the click that follows and any native
 * `contextmenu` (Android fires one on long press) are reported as suppressed.
 */
export class LongPress {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private start: { x: number; y: number; id: number } | null = null;
  private touches = new Set<number>();
  private firedAt = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly onLongPress: (x: number, y: number) => void,
    private readonly options: LongPressOptions = {},
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
  }

  get suppressed() {
    return performance.now() - this.firedAt < SUPPRESS_MS;
  }

  destroy() {
    this.cancel();
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.up);
  }

  private cancel() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.start = null;
  }

  private down = (e: PointerEvent) => {
    if (this.options.touchOnly !== false && e.pointerType !== 'touch') return;
    this.touches.add(e.pointerId);
    if (this.touches.size > 1) return this.cancel();
    const rect = this.el.getBoundingClientRect();
    this.start = { x: e.clientX - rect.left, y: e.clientY - rect.top, id: e.pointerId };
    this.timer = setTimeout(() => {
      if (!this.start) return;
      this.firedAt = performance.now();
      this.onLongPress(this.start.x, this.start.y);
      this.cancel();
    }, this.options.holdMs ?? 500);
  };

  private move = (e: PointerEvent) => {
    if (!this.start || e.pointerId !== this.start.id) return;
    const rect = this.el.getBoundingClientRect();
    const dx = e.clientX - rect.left - this.start.x;
    const dy = e.clientY - rect.top - this.start.y;
    if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) this.cancel();
  };

  private up = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    this.cancel();
  };
}
