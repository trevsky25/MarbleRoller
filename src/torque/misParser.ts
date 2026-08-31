// TorqueScript .mis mission file parser.
// Ported from MBHaxe's mis/MisParser.hx (MIT, RandomityGuy), itself derived
// from Vanilagy's MarbleBlast web port. Elements are kept generic
// ({type, name, fields}) instead of one class per type.
import { Vec3, Quat } from "../math/vec3";

export interface MisElement {
  type: string;
  name: string;
  id: number;
  fields: Map<string, string[]>;
  children: MisElement[];
}

export interface MisFile {
  root: MisElement;
  marbleAttributes: Map<string, string>;
}

export function fieldOf(el: MisElement, key: string): string | null {
  const v = el.fields.get(key.toLowerCase());
  return v !== undefined && v.length > 0 ? (v[0] ?? null) : null;
}

const elementHeadRegEx = /new\s+(\w+)\((.*?)\)\s*{/;
const assignmentRegEx = /(\$(?:\w|\d)+)\s*=\s*(.+?);/g;
const marbleAttributesRegEx = /setMarbleAttributes\("(\w+)",\s*(.+?)\);/g;

function indexIsInStringLiteral(text: string, index: number): boolean {
  let inString = false;
  for (let i = 0; i < index; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== "\\") inString = !inString;
  }
  return inString;
}

function indexOfIgnoreStringLiterals(text: string, searchString: string, position = 0): number {
  let inString = false;
  for (let i = position; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== "\\") inString = !inString;
    else if (!inString && text.startsWith(searchString, i)) return i;
  }
  return -1;
}

function splitIgnoreStringLiterals(text: string, splitter: string): string[] {
  const parts: string[] = [];
  let inString = false;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' && text[i - 1] !== "\\") inString = !inString;
    if (!inString && c === splitter) {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

function unescape(str: string): string {
  return str.replace(/\\(.)/g, "$1");
}

export class MisParser {
  private text: string;
  private index = 0;
  private currentElementId = 0;
  private variables = new Map<string, string>();

  constructor(text: string) {
    this.text = text;
  }

  parse(): MisFile {
    const objectWriteBeginIndex = this.text.indexOf("//--- OBJECT WRITE BEGIN ---");
    const objectWriteEndIndex = this.text.lastIndexOf("//--- OBJECT WRITE END ---");

    const outsideText =
      objectWriteBeginIndex !== -1 && objectWriteEndIndex !== -1
        ? this.text.substring(0, objectWriteBeginIndex) + this.text.substring(objectWriteEndIndex)
        : "";

    this.variables.set("$usermods", '""');
    for (const match of outsideText.matchAll(assignmentRegEx)) {
      if (!this.variables.has(match[1]!)) this.variables.set(match[1]!, match[2]!);
    }

    const marbleAttributes = new Map<string, string>();
    for (const match of outsideText.matchAll(marbleAttributesRegEx)) {
      marbleAttributes.set(match[1]!.toLowerCase(), this.resolveExpression(match[2]!));
    }

    if (objectWriteBeginIndex !== -1 && objectWriteEndIndex !== -1) {
      this.text = this.text.substring(objectWriteBeginIndex, objectWriteEndIndex);
    }

    this.removeComments();

    const indexOfMissionGroup = this.text.indexOf("new SimGroup(MissionGroup)");
    if (indexOfMissionGroup !== -1) this.index = indexOfMissionGroup;

    const elements: MisElement[] = [];
    while (this.hasNextElement()) {
      const element = this.readElement();
      if (element !== null) elements.push(element);
    }

    if (elements.length !== 1) {
      throw new Error("Mission file doesn't have exactly 1 outer element!");
    }

    return { root: elements[0]!, marbleAttributes };
  }

  private removeComments(): void {
    const blockCommentRegEx = /\/\*(.|\n)*?\*\//g;
    const lineCommentRegEx = /\/\/.*/g;
    let currentIndex = 0;
    for (;;) {
      blockCommentRegEx.lastIndex = currentIndex;
      lineCommentRegEx.lastIndex = currentIndex;
      let blockMatch: RegExpExecArray | null = blockCommentRegEx.exec(this.text);
      let lineMatch: RegExpExecArray | null = lineCommentRegEx.exec(this.text);

      if (blockMatch !== null && indexIsInStringLiteral(this.text, blockMatch.index)) blockMatch = null;
      if (lineMatch !== null && indexIsInStringLiteral(this.text, lineMatch.index)) lineMatch = null;

      if (blockMatch === null && lineMatch === null) break;
      if (lineMatch === null || (blockMatch !== null && blockMatch.index < lineMatch.index)) {
        const m = blockMatch!;
        this.text = this.text.substring(0, m.index) + this.text.substring(m.index + m[0].length);
        currentIndex = m.index;
      } else {
        const m = lineMatch;
        this.text = this.text.substring(0, m.index) + this.text.substring(m.index + m[0].length);
        currentIndex = m.index;
      }
    }
  }

  private hasNextElement(): boolean {
    const sub = this.text.substring(this.index);
    const match = elementHeadRegEx.exec(sub);
    if (match === null) return false;
    if (indexOfIgnoreStringLiterals(sub.substring(0, match.index), "}") !== -1) return false;
    return true;
  }

  private readElement(): MisElement | null {
    const sub = this.text.substring(this.index);
    const head = elementHeadRegEx.exec(sub);
    if (head === null) return null;
    this.index += head.index + head[0].length;
    const type = head[1]!;
    const name = head[2]!;

    let element: MisElement;
    if (type === "SimGroup" || type === "Path") {
      element = this.readSimGroup(type, name);
      if (type === "Path") {
        // Paths hold ordered Marker children
        element.children = element.children.filter((c) => c.type === "Marker");
        element.children.sort((a, b) => parseNumber(fieldOf(a, "seqnum") ?? "0") - parseNumber(fieldOf(b, "seqnum") ?? "0"));
      }
    } else {
      const fields = this.readValues();
      element = { type, name, id: 0, fields, children: [] };
    }
    element.id = this.currentElementId++;
    return element;
  }

  private readSimGroup(type: string, name: string): MisElement {
    const elements: MisElement[] = [];
    while (this.hasNextElement()) {
      const element = this.readElement();
      if (element !== null) elements.push(element);
    }

    let endingBraceIndex = indexOfIgnoreStringLiterals(this.text, "};", this.index);
    if (endingBraceIndex === -1) endingBraceIndex = this.text.length;
    this.index = endingBraceIndex + 2;

    return { type, name, id: 0, fields: new Map(), children: elements };
  }

  private readValues(): Map<string, string[]> {
    const obj = new Map<string, string[]>();
    let endingBraceIndex = indexOfIgnoreStringLiterals(this.text, "};", this.index);
    if (endingBraceIndex === -1) endingBraceIndex = this.text.length;
    const section = this.text.substring(this.index, endingBraceIndex).trim();
    const statements = splitIgnoreStringLiterals(section, ";").map((x) => x.trim());

    for (const statement of statements) {
      if (statement === "") continue;
      const splitIndex = statement.indexOf("=");
      if (splitIndex === -1) continue;
      let key = statement.substring(0, splitIndex).trim().toLowerCase();
      const value = statement.substring(splitIndex + 1).trim();

      if (key.endsWith("]")) {
        const openingIndex = key.indexOf("[");
        const arrayName = key.substring(0, openingIndex);
        let indexToken = key.substring(openingIndex + 1, key.indexOf("]"));
        let array = obj.get(arrayName);
        if (array === undefined) {
          array = [];
          obj.set(arrayName, array);
        }
        if (/[0-9]+/.test(indexToken)) {
          array[parseInt(indexToken, 10)] = this.resolveExpression(value);
        } else {
          indexToken = indexToken.replace(/"/g, "").trim();
          obj.set(arrayName + indexToken, [this.resolveExpression(value)]);
        }
      } else {
        obj.set(key, [this.resolveExpression(value)]);
      }
    }
    this.index = endingBraceIndex + 2;
    return obj;
  }

  private resolveExpression(expr: string): string {
    return splitIgnoreStringLiterals(expr, "@")
      .map((x) => {
        x = x.trim();
        const varValue = this.variables.get(x);
        if (x.startsWith("$") && varValue !== undefined) {
          x = this.resolveExpression(varValue);
        } else if (x.startsWith('"') && x.endsWith('"')) {
          x = unescape(x.substring(1, x.length - 1));
        }
        return x;
      })
      .join("");
  }
}

export function parseVector3(str: string | null): Vec3 {
  if (str === null) return new Vec3();
  const parts = str.split(" ").map((p) => parseFloat(p));
  if (parts.length < 3) return new Vec3();
  if (parts.some((x) => !Number.isFinite(x))) return new Vec3();
  return new Vec3(parts[0]!, parts[1]!, parts[2]!);
}

// Torque axis-angle rotation: "x y z angleDegrees" with the angle negated.
export function parseRotation(str: string | null): Quat {
  const quaternion = new Quat();
  if (str === null) return quaternion;
  const parts = str.split(" ").map((p) => parseFloat(p));
  if (parts.length < 4) return quaternion;
  if (parts.some((x) => !Number.isFinite(x))) return quaternion;
  quaternion.initRotateAxis(parts[0]!, parts[1]!, parts[2]!, (-parts[3]! * Math.PI) / 180);
  return quaternion;
}

export function parseNumber(str: string | null): number {
  if (str === null) return 0;
  const val = parseFloat(str.split(",")[0]!);
  return Number.isNaN(val) ? 0 : val;
}

export function parseBoolean(str: string | null): boolean {
  return !(str === null || str === "false" || str === "" || str === "0");
}
