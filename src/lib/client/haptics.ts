"use client";

class HapticsManager {
  private enabled: boolean = true;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("subscript:haptics_enabled");
        if (stored !== null) {
          this.enabled = stored === "true";
        }
      } catch {
        // localStorage might be unavailable or restricted in sandboxed environments
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(val: boolean): void {
    this.enabled = val;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("subscript:haptics_enabled", String(val));
      } catch {
        // Ignore localStorage quota or restriction errors
      }
    }
  }

  private canVibrate(): boolean {
    if (!this.enabled || typeof window === "undefined" || typeof navigator === "undefined") {
      return false;
    }
    // Respect system reduced-motion preference
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return false;
      }
    } catch {
      // Ignore matchMedia errors
    }
    return typeof navigator.vibrate === "function";
  }

  /** Subtle tick: Keypad digits, tab bar switches (10ms) */
  public microTick(): void {
    if (this.canVibrate()) {
      try { navigator.vibrate(10); } catch {}
    }
  }

  /** Crisp light snap: Action chips, toggles, backspace (20ms) */
  public lightSnap(): void {
    if (this.canVibrate()) {
      try { navigator.vibrate(20); } catch {}
    }
  }

  /** Medium impact: Review & Send, Approve button, 6th digit latch (35ms) */
  public mediumImpact(): void {
    if (this.canVibrate()) {
      try { navigator.vibrate(35); } catch {}
    }
  }

  /** Heavy thud: Destructive actions, session sign-out (60ms) */
  public heavyThud(): void {
    if (this.canVibrate()) {
      try { navigator.vibrate(60); } catch {}
    }
  }

  /** Success double-pulse: Transaction settled, address copied ([20ms, 45ms, 35ms]) */
  public success(): void {
    if (this.canVibrate()) {
      try { navigator.vibrate([20, 45, 35]); } catch {}
    }
  }

  /** Warning double-pulse: Low vault fuel, cancel confirmation ([30ms, 40ms, 30ms]) */
  public warning(): void {
    if (this.canVibrate()) {
      try { navigator.vibrate([30, 40, 30]); } catch {}
    }
  }

  /** Harsh error buzz: PIN failed shake, tx revert ([60ms, 40ms, 60ms, 40ms, 80ms]) */
  public error(): void {
    if (this.canVibrate()) {
      try { navigator.vibrate([60, 40, 60, 40, 80]); } catch {}
    }
  }

  /** Sustained hold latch: Hold-to-confirm cancellation (120ms) */
  public holdLatch(): void {
    if (this.canVibrate()) {
      try { navigator.vibrate(120); } catch {}
    }
  }
}

export const haptics = new HapticsManager();
