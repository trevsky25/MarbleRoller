// Esc pause menu + level select, styled after MBG's blue card / yellow pill
// UI but rendered as crisp DOM.
import { ResourceIndex } from "../assets/resourceIndex";
import { listCustomLevels, deleteCustomLevel } from "../editor/customLevel";
import { settings, updateSettings } from "./settings";

// The Home-card comic style, shared by Help/Credits and Options
const COMIC_CARD_CSS =
  "position:absolute;top:50%;left:50%;pointer-events:auto;display:flex;flex-direction:column;" +
  "transform:translate(-50%,-50%) perspective(1100px) rotateZ(-1.6deg) rotateY(-2deg);" +
  "background:linear-gradient(168deg,#9ed3f2 0%,#6fb3e6 45%,#5aa0da 100%);" +
  "border:4px solid #101820;border-radius:30px;" +
  "box-shadow:9px 12px 0 rgba(20,20,40,0.35),inset 0 3px 0 rgba(255,255,255,0.6);padding:24px 30px 28px;";

const COMIC_TITLE_CSS =
  "font:800 italic 46px 'Baloo 2',sans-serif;color:#f5872e;text-align:center;margin:0 0 14px;" +
  "-webkit-text-stroke:6px #17293c;paint-order:stroke fill;transform:rotate(-1.2deg);" +
  "text-shadow:3px 4px 0 rgba(20,20,40,0.3);";

const COMIC_BUTTON_CSS =
  "display:block;width:100%;margin:9px 0;padding:12px 24px;cursor:pointer;" +
  "border:3.5px solid #101820;border-radius:999px;" +
  "background:linear-gradient(180deg,#fdfbc0 0%,#f8ee7a 40%,#efd83f 100%);" +
  "box-shadow:4px 6px 0 rgba(20,20,40,0.4),inset 0 2px 0 rgba(255,255,255,0.8);" +
  "font:800 26px 'Baloo 2',sans-serif;color:#141414;text-align:center;transition:transform 0.08s;";

const TAB_CSS =
  "flex:1;padding:7px 4px;cursor:pointer;border:3px solid #101820;border-bottom:none;" +
  "border-radius:12px 12px 0 0;font:800 15px 'Baloo 2',sans-serif;text-align:center;";

interface LevelEntry {
  path: string;
  label: string;
}

export class PauseMenu {
  isOpen = false;
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  // set when the session is playing a custom level (enables Edit This Level)
  currentCustomName: string | null = null;
  // standalone home mode: the menu IS the app (no game behind it)
  private standalone = false;
  private lastLevelSelectOrigin: "pause" | "home" = "pause";

  // Entry point for booting straight into the Home screen.
  openHome(): void {
    this.standalone = true;
    this.isOpen = true;
    this.root.style.display = "block";
    this.showHome();
  }

  private root: HTMLDivElement;
  private index: ResourceIndex;
  private missionNames = new Map<string, string>();
  private missionLevels = new Map<string, number>();
  private namesLoaded = false;
  private currentTab = "beginner";

  constructor(index: ResourceIndex) {
    this.index = index;
    this.root = document.createElement("div");
    this.root.style.cssText = "position:absolute;inset:0;display:none;background:rgba(10,20,45,0.45);backdrop-filter:blur(3px);z-index:20;";
    document.body.appendChild(this.root);
  }

  private comicButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = COMIC_BUTTON_CSS;
    btn.onmouseenter = () => {
      btn.style.transform = "scale(1.03)";
      btn.style.filter = "brightness(1.07)";
    };
    btn.onmouseleave = () => {
      btn.style.transform = "";
      btn.style.filter = "";
    };
    btn.onmousedown = () => (btn.style.transform = "scale(0.98) translateY(2px)");
    btn.onmouseup = () => (btn.style.transform = "scale(1.03)");
    btn.onclick = onClick;
    return btn;
  }

  open(missionTitle: string): void {
    this.isOpen = true;
    this.root.style.display = "block";
    this.showMain(missionTitle);
  }

  close(): void {
    this.isOpen = false;
    this.root.style.display = "none";
  }

  private showMain(missionTitle: string): void {
    this.root.innerHTML = "";
    const card = document.createElement("div");
    card.style.cssText = COMIC_CARD_CSS + "width:360px;max-width:90vw;";

    const title = document.createElement("h1");
    title.textContent = "Paused";
    title.style.cssText = COMIC_TITLE_CSS;
    card.appendChild(title);

    if (missionTitle !== "") {
      const sub = document.createElement("div");
      sub.textContent = missionTitle;
      sub.style.cssText =
        "font:800 19px 'Baloo 2',sans-serif;color:#fff;text-align:center;margin:-10px 0 12px;" +
        "-webkit-text-stroke:3.5px #17293c;paint-order:stroke fill;";
      card.appendChild(sub);
    }

    card.appendChild(this.comicButton("Resume", () => this.onResume?.()));
    card.appendChild(this.comicButton("Restart Level", () => this.onRestart?.()));
    card.appendChild(this.comicButton("Level Select", () => void this.showLevelSelect("pause")));
    if (this.currentCustomName !== null) {
      card.appendChild(this.comicButton("Edit This Level", () => this.openEditor(this.currentCustomName!)));
    }
    card.appendChild(this.comicButton("Home", () => this.showHome()));

    const hint = document.createElement("div");
    hint.textContent = "Esc to resume";
    hint.style.cssText =
      "font:800 14px 'Baloo 2',sans-serif;color:#fff;text-align:center;margin-top:10px;" +
      "-webkit-text-stroke:2.5px rgba(23,41,60,0.7);paint-order:stroke fill;";
    card.appendChild(hint);

    this.root.appendChild(card);
  }

  private renderCustomList(listWrap: HTMLDivElement): void {
    const names = listCustomLevels();

    // New Level row
    const newRow = document.createElement("div");
    newRow.textContent = "+ New Level";
    newRow.style.cssText =
      "grid-column:1/-1;padding:8px 12px;margin:3px 0;cursor:pointer;border-radius:10px;text-align:center;" +
      "font:800 17px 'Baloo 2',sans-serif;color:#5b3a06;background:linear-gradient(180deg,#fdfbc0,#efd83f);border:2.5px solid #101820;";
    newRow.onclick = () => this.showNamePrompt(() => void this.showLevelSelect(this.lastLevelSelectOrigin));
    listWrap.appendChild(newRow);

    for (const name of names) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:5px 8px;margin:3px 0;cursor:pointer;border-radius:10px;" +
        "background:rgba(255,255,255,0.55);";
      const label = document.createElement("div");
      label.textContent = name;
      label.style.cssText = "flex:1;font:600 17px 'Baloo 2',sans-serif;color:#173a5e;";
      row.appendChild(label);

      const editBtn = document.createElement("button");
      editBtn.textContent = "✎";
      editBtn.title = "Edit";
      editBtn.style.cssText =
        "flex:none;width:30px;height:30px;cursor:pointer;border-radius:8px;border:2px solid #101820;" +
        "background:rgba(255,255,255,0.7);font-size:15px;";
      editBtn.onclick = (e) => {
        e.stopPropagation();
        this.openEditor(name);
      };
      row.appendChild(editBtn);

      // two-click confirm (window.confirm is blocked in sandboxed frames)
      const delBtn = document.createElement("button");
      delBtn.textContent = "🗑";
      delBtn.title = "Delete";
      delBtn.style.cssText = editBtn.style.cssText;
      let armed = false;
      delBtn.onclick = (e) => {
        e.stopPropagation();
        if (!armed) {
          armed = true;
          delBtn.textContent = "Sure?";
          delBtn.style.cssText = editBtn.style.cssText + "width:auto;padding:0 8px;background:#ff5040;color:#fff;font:800 13px 'Baloo 2',sans-serif;";
          return;
        }
        deleteCustomLevel(name);
        listWrap.innerHTML = "";
        this.renderCustomList(listWrap);
      };
      delBtn.onmouseleave = () => {
        if (armed) {
          armed = false;
          delBtn.textContent = "🗑";
          delBtn.style.cssText = editBtn.style.cssText;
        }
      };
      row.appendChild(delBtn);

      row.onmouseenter = () => (row.style.background = "#ffe98f");
      row.onmouseleave = () => (row.style.background = "rgba(255,255,255,0.55)");
      row.onclick = () => {
        const params = new URLSearchParams(window.location.search);
        params.delete("mis");
        params.delete("edit");
        params.set("custom", name);
        window.location.search = params.toString();
      };
      listWrap.appendChild(row);
    }

    if (names.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No custom levels yet — make one!";
      empty.style.cssText = "grid-column:1/-1;font:600 16px 'Baloo 2',sans-serif;color:#173a5e;text-align:center;padding:12px;";
      listWrap.appendChild(empty);
    }
  }

  private prettify(path: string): string {
    const base = path.substring(path.lastIndexOf("/") + 1).replace(/\.mis$/i, "");
    return base.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private async loadMissionNames(): Promise<void> {
    if (this.namesLoaded) return;
    this.namesLoaded = true;
    const paths = this.index.listFiles("data/missions/", ".mis");
    await Promise.all(
      paths.map(async (path) => {
        try {
          const url = this.index.resolve(path);
          if (url === null) return;
          const text = await (await fetch(url)).text();
          const match = /name\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(text);
          if (match !== null) this.missionNames.set(path, match[1]!.replace(/\\(.)/g, "$1"));
          const levelMatch = /level\s*=\s*"?(\d+)/.exec(text);
          if (levelMatch !== null) this.missionLevels.set(path, parseInt(levelMatch[1]!, 10));
        } catch {
          // fall back to filename
        }
      }),
    );
  }

  // In standalone mode there is no game to see behind the menu; keep the
  // classic backdrop art behind every view.
  private addBackdropIfStandalone(): void {
    if (!this.standalone) return;
    const backdropUrl = this.index.resolve("data/ui/background.jpg");
    if (backdropUrl !== null) {
      const backdrop = document.createElement("div");
      backdrop.style.cssText = `position:absolute;inset:0;background:url("${backdropUrl}") center/cover no-repeat;`;
      this.root.appendChild(backdrop);
    }
  }

  // The starburst MARBLE BLAST logo as crisp inline SVG.
  private static logoSvg(): string {
    const spikes = (count: number, rOuter: number, rInner: number, offset: number): string => {
      const pts: string[] = [];
      for (let i = 0; i < count * 2; i++) {
        const r = i % 2 === 0 ? rOuter : rInner;
        const a = (i / (count * 2)) * Math.PI * 2 + offset;
        pts.push(`${(100 + Math.cos(a) * r).toFixed(1)},${(100 + Math.sin(a) * r).toFixed(1)}`);
      }
      return pts.join(" ");
    };
    return `
    <svg viewBox="0 0 200 200" style="width:100%;height:100%;overflow:visible">
      <polygon points="${spikes(11, 98, 52, 0.28)}" fill="#c96a12"/>
      <polygon points="${spikes(11, 92, 50, 0)}" fill="#f6a41c"/>
      <polygon points="${spikes(11, 80, 47, 0.14)}" fill="#fbca3c"/>
      <circle cx="100" cy="100" r="52" fill="#1d4e9e"/>
      <circle cx="100" cy="100" r="52" fill="url(#mbSphere)"/>
      <defs>
        <radialGradient id="mbSphere" cx="0.35" cy="0.3">
          <stop offset="0%" stop-color="#5f8fd6"/>
          <stop offset="70%" stop-color="#1d4e9e"/>
          <stop offset="100%" stop-color="#123468"/>
        </radialGradient>
      </defs>
      <g transform="rotate(-8 100 100)">
        <text x="100" y="92" text-anchor="middle" font-family="'Baloo 2',sans-serif" font-weight="800" font-style="italic"
          font-size="34" fill="#ffffff" stroke="#a01818" stroke-width="7" paint-order="stroke">MARBLE</text>
        <text x="100" y="126" text-anchor="middle" font-family="'Baloo 2',sans-serif" font-weight="800" font-style="italic"
          font-size="34" fill="#ffffff" stroke="#a01818" stroke-width="7" paint-order="stroke">BLAST</text>
        <path d="M 44 138 Q 100 152 156 134" stroke="#d02020" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M 44 146 Q 100 160 156 142" stroke="#ffffff" stroke-width="5" fill="none" stroke-linecap="round"/>
      </g>
    </svg>`;
  }

  // Faithful recreation of the original MBG Home card — tilted blue panel,
  // starburst logo, yellow pill buttons — rendered as crisp vector UI.
  private showHome(): void {
    this.root.innerHTML = "";
    const backdropUrl = this.index.resolve("data/ui/background.jpg");
    if (backdropUrl !== null) {
      const backdrop = document.createElement("div");
      backdrop.style.cssText = `position:absolute;inset:0;background:url("${backdropUrl}") center/cover no-repeat;`;
      this.root.appendChild(backdrop);
    }

    const card = document.createElement("div");
    card.style.cssText =
      "position:absolute;top:50%;left:50%;width:428px;min-height:540px;padding:126px 36px 54px;pointer-events:auto;" +
      "display:flex;flex-direction:column;justify-content:center;box-sizing:content-box;" +
      "transform:translate(-50%,-50%) perspective(1100px) rotateZ(-2.5deg) rotateY(-3deg);" +
      "background:linear-gradient(168deg,#9ed3f2 0%,#6fb3e6 45%,#5aa0da 100%);" +
      "border:4px solid #101820;border-radius:34px 30px 40px 30px;" +
      "box-shadow:10px 14px 0 rgba(20,20,40,0.35),inset 0 3px 0 rgba(255,255,255,0.6);";

    // Starburst logo overlapping the top-left corner
    const logo = document.createElement("div");
    logo.style.cssText = "position:absolute;top:-72px;left:-62px;width:246px;height:246px;filter:drop-shadow(4px 6px 0 rgba(20,20,40,0.35));";
    logo.innerHTML = PauseMenu.logoSvg();
    card.appendChild(logo);

    const homeTitle = document.createElement("div");
    homeTitle.textContent = this.standalone ? "Home" : "Paused";
    homeTitle.style.cssText =
      "position:absolute;top:26px;right:40px;font:800 italic 66px 'Baloo 2',sans-serif;color:#f5872e;" +
      "-webkit-text-stroke:7px #17293c;paint-order:stroke fill;transform:rotate(-2deg);" +
      "text-shadow:3px 4px 0 rgba(20,20,40,0.3);";
    card.appendChild(homeTitle);

    let pillIndex = 0;
    const pill = (label: string, icon: string, iconLeft: boolean, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement("button");
      const wobble = [-0.8, 0.9, -0.5][pillIndex % 3]!;
      pillIndex++;
      btn.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;margin:14px 0;" +
        "padding:19px 30px;cursor:pointer;border:4px solid #101820;border-radius:999px;" +
        "background:linear-gradient(180deg,#fdfbc0 0%,#f8ee7a 40%,#efd83f 100%);" +
        "box-shadow:5px 7px 0 rgba(20,20,40,0.4),inset 0 2px 0 rgba(255,255,255,0.8);" +
        `transition:transform 0.08s;transform:rotate(${wobble}deg);`;
      const text = document.createElement("span");
      text.textContent = label;
      text.style.cssText = "font:800 44px/1.1 'Baloo 2',sans-serif;color:#141414;letter-spacing:0.5px;white-space:nowrap;";
      const ico = document.createElement("span");
      ico.textContent = icon;
      ico.style.cssText = "font-size:48px;line-height:1;filter:drop-shadow(1px 2px 0 rgba(20,20,40,0.3));";
      if (iconLeft) btn.append(ico, text);
      else btn.append(text, ico);
      if (iconLeft) text.style.marginRight = "auto";
      else text.style.marginRight = "0";
      btn.onmouseenter = () => {
        btn.style.transform = `rotate(${wobble}deg) scale(1.04)`;
        btn.style.filter = "brightness(1.07)";
      };
      btn.onmouseleave = () => {
        btn.style.transform = `rotate(${wobble}deg)`;
        btn.style.filter = "";
      };
      btn.onmousedown = () => (btn.style.transform = `rotate(${wobble}deg) scale(0.97) translateY(3px)`);
      btn.onmouseup = () => (btn.style.transform = `rotate(${wobble}deg) scale(1.04)`);
      btn.onclick = onClick;
      return btn;
    };

    card.appendChild(pill("Play", "🏸", false, () => void this.showLevelSelect("home")));
    card.appendChild(pill("Help/Credits", "🙋", true, () => this.showHelp()));
    card.appendChild(pill("Options", "⚙️", false, () => this.showOptions()));
    card.appendChild(pill("Build Level", "🔨", true, () => this.showNamePrompt(() => this.showHome())));
    if (!this.standalone) {
      card.appendChild(pill("Back to Game", "⬅️", true, () => this.onResume?.()));
    }

    this.root.appendChild(card);
  }

  private showHelp(): void {
    this.root.innerHTML = "";
    this.addBackdropIfStandalone();
    const card = document.createElement("div");
    card.style.cssText = COMIC_CARD_CSS + "width:560px;max-width:90vw;max-height:80vh;";

    const title = document.createElement("h1");
    title.textContent = "Help & Credits";
    title.style.cssText = COMIC_TITLE_CSS;
    card.appendChild(title);

    const content = document.createElement("div");
    content.style.cssText =
      "flex:1;overflow-y:auto;background:rgba(255,255,255,0.45);border:3px solid #101820;border-radius:16px;padding:14px 18px;" +
      "box-shadow:inset 0 2px 6px rgba(20,20,40,0.25);font:600 15px/1.5 'Baloo 2',sans-serif;color:#12314f;";

    const section = (heading: string): void => {
      const h = document.createElement("div");
      h.textContent = heading;
      h.style.cssText = "font:800 20px 'Baloo 2',sans-serif;color:#c05a10;margin:10px 0 4px;border-bottom:2.5px solid rgba(16,24,32,0.45);";
      content.appendChild(h);
    };
    const line = (html: string): void => {
      const p = document.createElement("div");
      p.innerHTML = html;
      p.style.marginBottom = "4px";
      content.appendChild(p);
    };
    const kbd = (k: string): string =>
      `<span style="display:inline-block;background:linear-gradient(180deg,#fdfbc0,#efd83f);color:#141414;border:2px solid #101820;` +
      `border-radius:7px;padding:0 7px;font-weight:800;font-size:13px;box-shadow:0 2px 0 rgba(20,20,40,0.4);">${k}</span>`;

    section("Goal");
    line("Roll your marble to the finish pad as fast as you can. Some levels hide gems — collect every gem before the finish counts!");

    section("Controls");
    line(`${kbd("W")} ${kbd("A")} ${kbd("S")} ${kbd("D")} roll the marble &nbsp; · &nbsp; ${kbd("Space")} jump`);
    line(`${kbd("Mouse")} camera (click to capture) &nbsp; · &nbsp; ${kbd("←")}${kbd("→")}${kbd("↑")}${kbd("↓")} camera keys`);
    line(`${kbd("E")} or ${kbd("Right Click")} use held powerup &nbsp; · &nbsp; ${kbd("R")} restart level`);
    line(`${kbd("Esc")} pause menu &nbsp; · &nbsp; ${kbd("G")} graphics mode toggle`);

    section("Powerups");
    line("🦘 <b>Super Jump</b> launches you upward · 💨 <b>Super Speed</b> boosts you forward · ⏱ <b>Time Travel</b> freezes the clock for a few seconds. Grab a powerup, use it when you need it.");

    section("Level Builder");
    line("Build Level opens the sandbox editor: place blocks and ramps with real game surfaces (ice slides, bouncy floors bounce), add pads, gems and powerups, then Play Test your creation. Custom levels appear under Play → Custom.");

    section("Credits");
    line("<b>Marble Blast Gold</b> — original game by GarageGames / Monster Studios (2002). All game assets belong to their rights holders.");
    line("This personal rebuild is ported from <b>MBHaxe</b> by RandomityGuy (MIT), which builds on the OpenMBU community's work.");
    line("Rebuild: TypeScript + Three.js. HUD/menu font: Baloo 2 by Ek Type (OFL). Not for distribution.");

    card.appendChild(content);

    const back = this.comicButton("Back", () => (this.standalone ? this.showHome() : this.showMain("")));
    back.style.marginTop = "14px";
    card.appendChild(back);

    this.root.appendChild(card);
  }

  private showOptions(): void {
    this.root.innerHTML = "";
    this.addBackdropIfStandalone();
    const card = document.createElement("div");
    card.style.cssText = COMIC_CARD_CSS + "width:400px;max-width:90vw;";

    const title = document.createElement("h1");
    title.textContent = "Options";
    title.style.cssText = COMIC_TITLE_CSS;
    card.appendChild(title);

    const row = (label: string): HTMLDivElement => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "margin:10px 0;";
      const lab = document.createElement("div");
      lab.textContent = label;
      lab.style.cssText = "font:800 20px 'Baloo 2',sans-serif;color:#fff;margin-bottom:6px;" +
        "-webkit-text-stroke:4px #17293c;paint-order:stroke fill;";
      wrap.appendChild(lab);
      card.appendChild(wrap);
      return wrap;
    };

    const toggleChips = (wrap: HTMLDivElement, choices: [string, string][], current: string, onPick: (id: string) => void): void => {
      const chipRow = document.createElement("div");
      chipRow.style.cssText = "display:flex;gap:10px;";
      for (const [id, label] of choices) {
        const chip = document.createElement("button");
        chip.textContent = label;
        const selected = id === current;
        chip.style.cssText =
          `flex:1;padding:9px;cursor:pointer;border-radius:999px;font:800 18px 'Baloo 2',sans-serif;` +
          `border:3px solid #101820;transition:transform 0.08s;` +
          (selected
            ? "background:linear-gradient(180deg,#fdfbc0 0%,#f8ee7a 40%,#efd83f 100%);color:#141414;" +
              "box-shadow:3px 4px 0 rgba(20,20,40,0.4),inset 0 2px 0 rgba(255,255,255,0.8);"
            : "background:rgba(255,255,255,0.35);color:#2a3a4a;box-shadow:inset 0 2px 4px rgba(20,20,40,0.25);");
        chip.onmouseenter = () => {
          chip.style.filter = "brightness(1.1)";
          chip.style.transform = "scale(1.03)";
        };
        chip.onmouseleave = () => {
          chip.style.filter = "";
          chip.style.transform = "";
        };
        chip.onclick = () => {
          onPick(id);
          this.showOptions();
        };
        chipRow.appendChild(chip);
      }
      wrap.appendChild(chipRow);
    };

    // Graphics mode
    const gfxRow = row("Graphics");
    toggleChips(
      gfxRow,
      [
        ["enhanced", "Enhanced"],
        ["classic", "Classic"],
      ],
      settings.gfxMode,
      (id) => updateSettings({ gfxMode: id as "enhanced" | "classic" }),
    );
    const gfxHint = document.createElement("div");
    gfxHint.textContent = "Takes effect when a level loads";
    gfxHint.style.cssText = "font:600 12px 'Baloo 2',sans-serif;color:#dceeff;opacity:0.8;margin-top:3px;";
    gfxRow.appendChild(gfxHint);

    // Mouse sensitivity
    const sensRow = row(`Mouse Sensitivity — ${Math.round(settings.mouseSensitivity * 100)}%`);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(settings.mouseSensitivity * 100));
    slider.style.cssText = "width:100%;accent-color:#f5bd2e;cursor:pointer;height:26px;";
    slider.oninput = () => {
      updateSettings({ mouseSensitivity: parseInt(slider.value, 10) / 100 });
      const lab = sensRow.firstChild as HTMLDivElement;
      lab.textContent = `Mouse Sensitivity — ${slider.value}%`;
    };
    sensRow.appendChild(slider);

    // Invert Y
    const invRow = row("Invert Camera Y");
    toggleChips(
      invRow,
      [
        ["off", "Off"],
        ["on", "On"],
      ],
      settings.invertY ? "on" : "off",
      (id) => updateSettings({ invertY: id === "on" }),
    );

    const back = this.comicButton("Back", () => (this.standalone ? this.showHome() : this.showMain("")));
    back.style.marginTop = "16px";
    card.appendChild(back);

    this.root.appendChild(card);
  }

  // In-menu name entry (window.prompt is blocked in sandboxed frames)
  private showNamePrompt(onCancel: () => void): void {
    this.root.innerHTML = "";
    this.addBackdropIfStandalone();
    const card = document.createElement("div");
    card.style.cssText = COMIC_CARD_CSS + "width:340px;max-width:90vw;";

    const title = document.createElement("h1");
    title.textContent = "New Custom Level";
    title.style.cssText = COMIC_TITLE_CSS.replace("46px", "38px");
    card.appendChild(title);

    const sub = document.createElement("div");
    sub.textContent = "Sandbox — official levels can't be edited";
    sub.style.cssText =
      "font:600 13px 'Baloo 2',sans-serif;color:#0d2c4d;background:#ffe37a;border-radius:8px;" +
      "padding:3px 10px;margin:-6px auto 12px;text-align:center;width:fit-content;";
    card.appendChild(sub);

    const input = document.createElement("input");
    input.type = "text";
    input.value = "My Level";
    input.maxLength = 40;
    input.style.cssText =
      "display:block;width:100%;box-sizing:border-box;padding:10px 14px;margin-bottom:12px;" +
      "border-radius:12px;border:3px solid #101820;background:rgba(255,255,255,0.9);" +
      "font:600 18px 'Baloo 2',sans-serif;color:#173a5e;outline:none;text-align:center;";
    input.onfocus = () => input.select();
    card.appendChild(input);

    const create = this.comicButton("Create", () => {
      const name = input.value.trim();
      if (name !== "") this.openEditor(name);
    });
    card.appendChild(create);
    card.appendChild(this.comicButton("Cancel", onCancel));

    input.onkeydown = (e) => {
      if (e.key === "Enter") create.click();
      e.stopPropagation();
    };

    this.root.appendChild(card);
    setTimeout(() => input.focus(), 50);
  }

  private openEditor(name: string): void {
    const params = new URLSearchParams(window.location.search);
    params.delete("mis");
    params.delete("custom");
    params.set("edit", name);
    window.location.search = params.toString();
  }

  private async showLevelSelect(origin: "pause" | "home" = "pause"): Promise<void> {
    this.lastLevelSelectOrigin = origin;
    this.root.innerHTML = "";
    this.addBackdropIfStandalone();
    const card = document.createElement("div");
    // Wider, shorter layout: two-column level grid
    card.style.cssText = COMIC_CARD_CSS + "min-width:640px;max-width:760px;max-height:76vh;";

    const title = document.createElement("h1");
    title.textContent = "Level Select";
    title.style.cssText = COMIC_TITLE_CSS;
    card.appendChild(title);

    const tabRow = document.createElement("div");
    tabRow.style.cssText = "display:flex;gap:6px;margin-bottom:0;padding:0 6px;";
    const listWrap = document.createElement("div");
    listWrap.style.cssText =
      "flex:1;overflow-y:auto;background:rgba(255,255,255,0.45);border:3px solid #101820;border-radius:14px;padding:8px;min-height:120px;" +
      "box-shadow:inset 0 2px 6px rgba(20,20,40,0.25);" +
      "display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;align-content:start;";

    const renderList = (category: string): void => {
      this.currentTab = category;
      for (const child of Array.from(tabRow.children) as HTMLElement[]) {
        const active = child.dataset.cat === category;
        child.style.background = active ? "linear-gradient(180deg,#fdfbc0,#efd83f)" : "rgba(23,41,60,0.55)";
        child.style.color = active ? "#141414" : "#cfe4f7";
      }
      listWrap.innerHTML = "";
      if (category === "custom") {
        this.renderCustomList(listWrap);
        return;
      }
      const paths = this.index.listFiles(`data/missions/${category}/`, ".mis");
      const entries: (LevelEntry & { level: number | null })[] = paths.map((path) => ({
        path,
        label: this.missionNames.get(path) ?? this.prettify(path),
        level: this.missionLevels.get(path) ?? null,
      }));
      // Canonical MBG order via MissionInfo's level field; unnumbered last
      entries.sort((a, b) => {
        if (a.level !== null && b.level !== null) return a.level - b.level;
        if (a.level !== null) return -1;
        if (b.level !== null) return 1;
        return a.label.localeCompare(b.label);
      });
      for (const entry of entries) {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:10px;padding:5px 8px;margin:3px 0;cursor:pointer;border-radius:10px;" +
          "background:rgba(255,255,255,0.55);";

        // The original per-level preview image sits next to the .mis file
        const base = entry.path.replace(/\.mis$/i, "");
        let previewUrl: string | null = null;
        for (const ext of [".jpg", ".png", ".jpeg", ".bmp"]) {
          if (this.index.exists(base + ext)) {
            previewUrl = this.index.resolve(base + ext);
            break;
          }
        }
        const num = document.createElement("div");
        num.textContent = entry.level !== null ? String(entry.level) : "–";
        num.style.cssText =
          "flex:none;min-width:30px;height:30px;display:flex;align-items:center;justify-content:center;" +
          "background:#17293c;color:#fff;border-radius:9px;padding:0 4px;" +
          "font:800 16px 'Baloo 2',sans-serif;box-shadow:inset 0 -2px 0 rgba(0,0,30,0.3);";
        row.appendChild(num);

        const thumb = document.createElement("div");
        thumb.style.cssText =
          "flex:none;width:72px;height:54px;border-radius:8px;border:2.5px solid #101820;" +
          "background:#9cc4e4 center/cover no-repeat;box-shadow:inset 0 0 4px rgba(0,0,30,0.35);";
        if (previewUrl !== null) thumb.style.backgroundImage = `url("${previewUrl}")`;
        row.appendChild(thumb);

        const label = document.createElement("div");
        label.textContent = entry.label;
        label.style.cssText = "font:600 17px 'Baloo 2',sans-serif;color:#173a5e;";
        row.appendChild(label);

        row.onmouseenter = () => (row.style.background = "#ffe98f");
        row.onmouseleave = () => (row.style.background = "rgba(255,255,255,0.55)");
        row.onclick = () => {
          const params = new URLSearchParams(window.location.search);
          params.set("mis", entry.path);
          window.location.search = params.toString();
        };
        listWrap.appendChild(row);
      }
      if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "No levels found";
        empty.style.cssText = "font:600 16px 'Baloo 2',sans-serif;color:#173a5e;text-align:center;padding:16px;";
        listWrap.appendChild(empty);
      }
    };

    for (const category of ["beginner", "intermediate", "advanced", "custom"]) {
      const tab = document.createElement("div");
      tab.textContent = category.charAt(0).toUpperCase() + category.substring(1);
      tab.dataset.cat = category;
      tab.style.cssText = TAB_CSS;
      tab.onclick = () => renderList(category);
      tabRow.appendChild(tab);
    }

    card.appendChild(tabRow);
    card.appendChild(listWrap);

    const back = this.comicButton("Back", () => (origin === "home" ? this.showHome() : this.showMain("")));
    back.style.marginTop = "14px";
    card.appendChild(back);

    this.root.appendChild(card);
    renderList(this.currentTab);

    // Fill in real mission names asynchronously, then re-render
    if (!this.namesLoaded) {
      await this.loadMissionNames();
      if (this.isOpen && listWrap.isConnected) renderList(this.currentTab);
    }
  }
}
