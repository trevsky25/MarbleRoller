// In-game HUD built from the original UI images (timer digits, center
// ready/set/go text, gem counter), mirroring MBG's PlayGui layout.
import { ResourceIndex } from "../assets/resourceIndex";

export type CenterText = "none" | "ready" | "set" | "go" | "outofbounds";

export class Hud {
  private root: HTMLDivElement;
  private centerImg: HTMLImageElement;
  private timerDiv: HTMLDivElement;
  private gemDiv: HTMLDivElement;
  private helpDiv: HTMLDivElement;
  private alertDiv: HTMLDivElement;
  private powerupDiv: HTMLDivElement;
  private index: ResourceIndex;
  private currentCenter: CenterText = "none";
  private lastTimerString = "";
  private lastGemString = "";
  private helpTimeout = 0;
  private alertTimeout = 0;
  // Vector mode: crisp DPI-independent text instead of the 2002 bitmap sprites
  private vector: boolean;
  private centerTextDiv: HTMLDivElement;

  constructor(index: ResourceIndex, vector = false) {
    this.index = index;
    this.vector = vector;
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:absolute;inset:0;pointer-events:none;font-family:'Baloo 2','Trebuchet MS',Verdana,sans-serif;overflow:hidden;";
    document.body.appendChild(this.root);

    this.timerDiv = document.createElement("div");
    this.timerDiv.style.cssText =
      "position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;align-items:center;height:36px;";
    this.root.appendChild(this.timerDiv);

    this.gemDiv = document.createElement("div");
    this.gemDiv.style.cssText =
      "position:absolute;top:8px;right:12px;display:flex;align-items:center;height:36px;display:none;";
    this.root.appendChild(this.gemDiv);

    this.centerImg = document.createElement("img");
    this.centerImg.style.cssText =
      "position:absolute;top:20%;left:50%;transform:translateX(-50%);display:none;image-rendering:auto;height:60px;";
    this.root.appendChild(this.centerImg);

    this.centerTextDiv = document.createElement("div");
    this.centerTextDiv.style.cssText =
      "position:absolute;top:18%;left:50%;transform:translateX(-50%);display:none;" +
      "font-family:'Baloo 2','Trebuchet MS',sans-serif;font-weight:800;font-size:68px;" +
      "-webkit-text-stroke:6px rgba(20,20,30,0.9);paint-order:stroke fill;letter-spacing:1px;" +
      "text-shadow:0 4px 0 rgba(0,0,0,0.25);white-space:nowrap;";
    this.root.appendChild(this.centerTextDiv);

    this.helpDiv = document.createElement("div");
    this.helpDiv.style.cssText =
      "position:absolute;top:32%;left:50%;transform:translateX(-50%);color:#fff;font-size:22px;font-weight:600;" +
      "-webkit-text-stroke:3.5px rgba(20,20,30,0.85);paint-order:stroke fill;" +
      "text-align:center;max-width:70%;display:none;";
    this.root.appendChild(this.helpDiv);

    this.alertDiv = document.createElement("div");
    this.alertDiv.style.cssText =
      "position:absolute;bottom:10%;left:50%;transform:translateX(-50%);color:#ffe14d;font-size:24px;font-weight:800;" +
      "-webkit-text-stroke:4px rgba(20,20,30,0.85);paint-order:stroke fill;" +
      "text-align:center;max-width:80%;display:none;";
    this.root.appendChild(this.alertDiv);

    this.powerupDiv = document.createElement("div");
    this.powerupDiv.style.cssText =
      "position:absolute;top:52px;right:12px;color:#fff;font-size:16px;font-weight:600;" +
      "-webkit-text-stroke:3px rgba(20,20,30,0.85);paint-order:stroke fill;display:none;";
    this.root.appendChild(this.powerupDiv);
  }

  private numberImg(char: string): string | null {
    const name = char === ":" ? "colon" : char === "." ? "point" : char === "/" ? "slash" : char === "-" ? "dash" : char;
    return this.index.resolve(`data/ui/game/numbers/${name}.png`);
  }

  private renderNumberString(container: HTMLDivElement, str: string): void {
    if (this.vector) {
      container.style.font = "800 38px 'Baloo 2','Trebuchet MS',sans-serif";
      container.style.color = "#ffd93b";
      container.style.webkitTextStroke = "4.5px rgba(20,20,30,0.9)";
      (container.style as unknown as Record<string, string>).paintOrder = "stroke fill";
      container.style.textShadow = "0 3px 0 rgba(0,0,0,0.25)";
      container.style.letterSpacing = "1px";
      container.style.fontVariantNumeric = "tabular-nums";
      container.textContent = str;
      return;
    }
    container.innerHTML = "";
    for (const char of str) {
      const url = this.numberImg(char);
      if (url === null) continue;
      const img = document.createElement("img");
      img.src = url;
      img.style.height = "36px";
      const narrow = char === ":" || char === "." || char === "/";
      img.style.marginLeft = narrow ? "-6px" : "-8px";
      img.style.marginRight = narrow ? "-6px" : "-8px";
      container.appendChild(img);
    }
  }

  setTimer(seconds: number): void {
    if (seconds < 0) seconds = 0;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const hundredths = Math.floor((seconds * 100) % 100);
    const str = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
    if (str === this.lastTimerString) return;
    this.lastTimerString = str;
    this.renderNumberString(this.timerDiv, str);
  }

  setGems(count: number, total: number): void {
    this.gemDiv.style.display = total > 0 ? "flex" : "none";
    if (total === 0) return;
    const str = `${count}/${total}`;
    if (str === this.lastGemString) return;
    this.lastGemString = str;
    this.renderNumberString(this.gemDiv, str);
  }

  setCenterText(text: CenterText): void {
    if (text === this.currentCenter) return;
    this.currentCenter = text;
    if (text === "none") {
      this.centerImg.style.display = "none";
      this.centerTextDiv.style.display = "none";
      return;
    }
    if (this.vector) {
      const styles: Record<Exclude<CenterText, "none">, { label: string; color: string }> = {
        ready: { label: "Ready", color: "#ff9d2e" },
        set: { label: "Set", color: "#ffd93b" },
        go: { label: "Go!", color: "#4cd944" },
        outofbounds: { label: "Out of Bounds", color: "#ff5040" },
      };
      const s = styles[text];
      this.centerTextDiv.textContent = s.label;
      this.centerTextDiv.style.color = s.color;
      this.centerTextDiv.style.display = "block";
      return;
    }
    const url = this.index.resolve(`data/ui/game/${text}.png`);
    if (url !== null) {
      this.centerImg.src = url;
      this.centerImg.style.display = "block";
    }
  }

  displayHelp(text: string): void {
    this.helpDiv.textContent = text;
    this.helpDiv.style.display = "block";
    window.clearTimeout(this.helpTimeout);
    this.helpTimeout = window.setTimeout(() => (this.helpDiv.style.display = "none"), 3000);
  }

  displayAlert(text: string): void {
    this.alertDiv.textContent = text;
    this.alertDiv.style.display = "block";
    window.clearTimeout(this.alertTimeout);
    this.alertTimeout = window.setTimeout(() => (this.alertDiv.style.display = "none"), 5000);
  }

  setPowerup(name: string | null): void {
    if (name === null) {
      this.powerupDiv.style.display = "none";
    } else {
      this.powerupDiv.textContent = name;
      this.powerupDiv.style.display = "block";
    }
  }
}
