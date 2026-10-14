/** true when this browser can draw the 3D room (and the player has not asked for the flat scene with ?scene=2d). */
export function canUse3dScene(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("scene") === "2d") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
