// Datablock -> shape definition mapping, ported from MBHaxe's
// addStaticShapeOrItem macro and the shapes/ classes (MIT).
export type ShapeKind =
  | "startPad"
  | "endPad"
  | "sign"
  | "gem"
  | "superJump"
  | "superSpeed"
  | "shockAbsorber"
  | "superBounce"
  | "helicopter"
  | "timeTravel"
  | "antiGravity"
  | "decoration";

export interface ShapeDef {
  kind: ShapeKind;
  dtsPath: string;
  matNameOverride?: Map<string, string>;
  pickUpName?: string;
}

export const GEM_COLORS = ["blue", "red", "yellow", "purple", "green", "turquoise", "orange", "black"];

export function shapeDefForDataBlock(dataBlockRaw: string, elementName: string): ShapeDef | null {
  const dataBlock = dataBlockRaw.toLowerCase();
  if (dataBlock === "") return null;

  if (["startpad", "startpad_mbg", "startpad_mbp", "startpad_mbu"].includes(dataBlock)) {
    return { kind: "startPad", dtsPath: "data/shapes/pads/startarea.dts" };
  }
  if (["endpad", "endpad_mbg", "endpad_mbp", "endpad_mbu"].includes(dataBlock)) {
    return { kind: "endPad", dtsPath: "data/shapes/pads/endarea.dts" };
  }
  if (dataBlock === "signfinish") {
    return { kind: "sign", dtsPath: "data/shapes/signs/finishlinesign.dts" };
  }
  if (dataBlock.startsWith("signplain")) {
    // SignPlain skins: SignPlainRight -> right.plainsign, etc.
    const direction = dataBlock.substring("signplain".length);
    const override = new Map<string, string>();
    if (direction !== "") override.set("base.plainsign", `${direction}.plainsign`);
    return { kind: "sign", dtsPath: "data/shapes/signs/plainsign.dts", matNameOverride: override };
  }
  if (dataBlock.startsWith("signcaution")) {
    // SignCaution skins: caution/danger
    const type = dataBlock.substring("signcaution".length);
    const override = new Map<string, string>();
    if (type !== "") override.set("base.cautionsign", `${type}.cautionsign`);
    return { kind: "sign", dtsPath: "data/shapes/signs/cautionsign.dts", matNameOverride: override };
  }
  if (dataBlock.startsWith("gemitem")) {
    return { kind: "gem", dtsPath: "data/shapes/items/gem.dts" };
  }
  if (dataBlock === "superjumpitem" || dataBlock === "superjumpitem_mbu") {
    return { kind: "superJump", dtsPath: "data/shapes/items/superjump.dts", pickUpName: "Super Jump PowerUp" };
  }
  if (dataBlock === "superspeeditem" || dataBlock === "superspeeditem_mbu") {
    return { kind: "superSpeed", dtsPath: "data/shapes/items/superspeed.dts", pickUpName: "Super Speed PowerUp" };
  }
  if (dataBlock === "shockabsorberitem") {
    return { kind: "shockAbsorber", dtsPath: "data/shapes/items/shockabsorber.dts", pickUpName: "Shock Absorber PowerUp" };
  }
  if (dataBlock === "superbounceitem") {
    return { kind: "superBounce", dtsPath: "data/shapes/items/superbounce.dts", pickUpName: "Super Bounce PowerUp" };
  }
  if (dataBlock === "helicopteritem" || dataBlock === "helicopteritem_mbu") {
    return { kind: "helicopter", dtsPath: "data/shapes/images/helicopter.dts", pickUpName: "Gyrocopter PowerUp" };
  }
  if (dataBlock === "timetravelitem" || dataBlock === "timepenaltyitem" || dataBlock === "timetravelitem_mbu") {
    return { kind: "timeTravel", dtsPath: "data/shapes/items/timetravel.dts" };
  }
  if (dataBlock === "antigravityitem" || dataBlock === "antigravityitem_mbu" || dataBlock === "norespawnantigravityitem") {
    return { kind: "antiGravity", dtsPath: "data/shapes/items/antigravity.dts", pickUpName: "Gravity Modifier" };
  }
  console.warn(`Unknown shape datablock: ${dataBlockRaw} (${elementName})`);
  return null;
}
