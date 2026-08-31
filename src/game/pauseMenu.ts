// Esc pause menu + level select, styled after MBG's blue card / yellow pill
// UI but rendered as crisp DOM.
import { ResourceIndex } from "../assets/resourceIndex";
import { listCustomLevels, deleteCustomLevel } from "../editor/customLevel";

const CARD_CSS =
  "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);" +
  "min-width:340px;max-width:440px;max-height:78vh;display:flex;flex-direction:column;" +
  "background:linear-gradient(180deg,#8ecdf5 0%,#5aa7e0 55%,#4f97d2 100%);" +
  "border:5px solid #2c5d94;border-radius:26px;box-shadow:0 14px 40px rgba(0,0,20,0.45),inset 0 2px 0 rgba(255,255,255,0.55);" +
  "padding:22px 26px;pointer-events:auto;";

const TITLE_CSS =
  "font:800 40px 'Baloo 2','Trebuchet MS',sans-serif;color:#fff;text-align:center;margin:0 0 14px;" +
  "-webkit-text-stroke:5px rgba(26,54,88,0.9);paint-order:stroke fill;letter-spacing:1px;";

const BUTTON_CSS =
  "display:block;width:100%;margin:7px 0;padding:10px 18px;cursor:pointer;" +
  "background:linear-gradient(180deg,#fff3b0 0%,#ffd94d 45%,#f5bd2e 100%);" +
  "border:3px solid #a06a12;border-radius:999px;" +
  "font:800 22px 'Baloo 2','Trebuchet MS',sans-serif;color:#5b3a06;text-align:center;" +
  "box-shadow:0 3px 0 #8a5a0e,inset 0 2px 0 rgba(255,255,255,0.7);";

const TAB_CSS =
  "flex:1;padding:6px 4px;cursor:pointer;border:3px solid #2c5d94;border-bottom:none;" +
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

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = BUTTON_CSS;
    btn.onmouseenter = () => (btn.style.filter = "brightness(1.08)");
    btn.onmouseleave = () => (btn.style.filter = "");
    btn.onmousedown = () => (btn.style.transform = "translateY(2px)");
    btn.onmouseup = () => (btn.style.transform = "");
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
    card.style.cssText = CARD_CSS;

    const title = document.createElement("h1");
    title.textContent = "Paused";
    title.style.cssText = TITLE_CSS;
    card.appendChild(title);

    if (missionTitle !== "") {
      const sub = document.createElement("div");
      sub.textContent = missionTitle;
      sub.style.cssText =
        "font:600 18px 'Baloo 2',sans-serif;color:#eaf6ff;text-align:center;margin:-8px 0 12px;" +
        "-webkit-text-stroke:2.5px rgba(26,54,88,0.8);paint-order:stroke fill;";
      card.appendChild(sub);
    }

    card.appendChild(this.button("Resume", () => this.onResume?.()));
    card.appendChild(this.button("Restart Level", () => this.onRestart?.()));
    card.appendChild(this.button("Level Select", () => void this.showLevelSelect("pause")));
    if (this.currentCustomName !== null) {
      card.appendChild(this.button("Edit This Level", () => this.openEditor(this.currentCustomName!)));
    }
    card.appendChild(this.button("Home", () => this.showHome()));

    const hint = document.createElement("div");
    hint.textContent = "Esc to resume";
    hint.style.cssText = "font:600 14px 'Baloo 2',sans-serif;color:#dceeff;text-align:center;margin-top:10px;opacity:0.85;";
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
      "font:800 17px 'Baloo 2',sans-serif;color:#5b3a06;background:linear-gradient(180deg,#fff3b0,#f5bd2e);border:2px solid #a06a12;";
    newRow.onclick = () => {
      const name = prompt("Level name:", "My Level");
      if (name !== null && name.trim() !== "") this.openEditor(name.trim());
    };
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
        "flex:none;width:30px;height:30px;cursor:pointer;border-radius:8px;border:2px solid #2c5d94;" +
        "background:rgba(255,255,255,0.7);font-size:15px;";
      editBtn.onclick = (e) => {
        e.stopPropagation();
        this.openEditor(name);
      };
      row.appendChild(editBtn);

      const delBtn = document.createElement("button");
      delBtn.textContent = "🗑";
      delBtn.title = "Delete";
      delBtn.style.cssText = editBtn.style.cssText;
      delBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${name}"?`)) {
          deleteCustomLevel(name);
          listWrap.innerHTML = "";
          this.renderCustomList(listWrap);
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

  // MBG-style Home screen over the classic backdrop art
  private showHome(): void {
    this.root.innerHTML = "";
    const backdropUrl = this.index.resolve("data/ui/background.jpg");
    if (backdropUrl !== null) {
      const backdrop = document.createElement("div");
      backdrop.style.cssText = `position:absolute;inset:0;background:url("${backdropUrl}") center/cover no-repeat;`;
      this.root.appendChild(backdrop);
    }

    const card = document.createElement("div");
    card.style.cssText = CARD_CSS;

    const title = document.createElement("h1");
    title.textContent = "Marble Blast";
    title.style.cssText = TITLE_CSS;
    card.appendChild(title);

    card.appendChild(this.button("Play", () => void this.showLevelSelect("home")));
    card.appendChild(
      this.button("Build Custom Level", () => {
        const name = prompt("Name for your custom level (sandbox — official levels can't be edited):", "My Level");
        if (name !== null && name.trim() !== "") this.openEditor(name.trim());
      }),
    );
    card.appendChild(this.button("Back to Game", () => this.onResume?.()));

    this.root.appendChild(card);
  }

  private openEditor(name: string): void {
    const params = new URLSearchParams(window.location.search);
    params.delete("mis");
    params.delete("custom");
    params.set("edit", name);
    window.location.search = params.toString();
  }

  private async showLevelSelect(origin: "pause" | "home" = "pause"): Promise<void> {
    this.root.innerHTML = "";
    const card = document.createElement("div");
    // Wider, shorter layout: two-column level grid
    card.style.cssText = CARD_CSS + "min-width:640px;max-width:760px;max-height:72vh;";

    const title = document.createElement("h1");
    title.textContent = "Level Select";
    title.style.cssText = TITLE_CSS.replace("40px", "32px");
    card.appendChild(title);

    const tabRow = document.createElement("div");
    tabRow.style.cssText = "display:flex;gap:4px;margin-bottom:0;";
    const listWrap = document.createElement("div");
    listWrap.style.cssText =
      "flex:1;overflow-y:auto;background:rgba(255,255,255,0.28);border:3px solid #2c5d94;border-radius:0 0 14px 14px;padding:8px;min-height:120px;" +
      "display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;align-content:start;";

    const renderList = (category: string): void => {
      this.currentTab = category;
      for (const child of Array.from(tabRow.children) as HTMLElement[]) {
        const active = child.dataset.cat === category;
        child.style.background = active ? "rgba(255,255,255,0.35)" : "rgba(20,50,90,0.35)";
        child.style.color = active ? "#fff" : "#cfe4f7";
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
          "background:#2c5d94;color:#fff;border-radius:9px;padding:0 4px;" +
          "font:800 16px 'Baloo 2',sans-serif;box-shadow:inset 0 -2px 0 rgba(0,0,30,0.3);";
        row.appendChild(num);

        const thumb = document.createElement("div");
        thumb.style.cssText =
          "flex:none;width:72px;height:54px;border-radius:8px;border:2px solid #2c5d94;" +
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

    const back = this.button("Back", () => (origin === "home" ? this.showHome() : this.showMain("")));
    back.style.marginTop = "12px";
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
