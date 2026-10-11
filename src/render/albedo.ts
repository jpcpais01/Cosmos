/**
 * Brightness correction per body so the maps (which are contrast-stretched for display) reflect light with
 * roughly the body's real albedo: scale = 0.85 * albedo / mean linear texture value (clamped).
 * Generated from the 1024 px maps; the Earth uses its own shading.
 */
export const ALBEDO_SCALE: Record<string, number> = {
  ariel: 0.87,
  callisto: 1.06,
  charon: 0.76,
  deimos: 1.6,
  dione: 1.6,
  enceladus: 1.53,
  europa: 1.0,
  ganymede: 0.87,
  iapetus: 1.6,
  io: 1.19,
  jupiter: 1.06,
  mars: 1.01,
  mercury: 0.52,
  mimas: 1.6,
  miranda: 0.56,
  moon: 0.35,
  neptune: 1.6,
  oberon: 0.9,
  phobos: 1.6,
  pluto: 1.29,
  rhea: 1.34,
  saturn: 0.69,
  tethys: 1.57,
  titan: 1.6,
  titania: 0.87,
  triton: 1.6,
  umbriel: 0.9,
  uranus: 0.77,
  venus: 1.27,
};
