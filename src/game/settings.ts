// Persistent game settings (localStorage), read live by the systems they
// affect. URL params still override per-session (?gfx=classic).
export interface GameSettings {
  gfxMode: "enhanced" | "classic";
  mouseSensitivity: number; // 0..1, MBG default 0.6
  invertY: boolean;
}

const KEY = "mbg-settings";

const DEFAULTS: GameSettings = {
  gfxMode: "enhanced",
  mouseSensitivity: 0.6,
  invertY: false,
};

function load(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: GameSettings = load();

export function updateSettings(partial: Partial<GameSettings>): void {
  Object.assign(settings, partial);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable; settings stay session-only
  }
}
