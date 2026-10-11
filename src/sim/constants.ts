/** Physical constants. Distances are in kilometres, times in seconds unless noted. */
export const C_KMS = 299_792.458;
export const AU_KM = 149_597_870.7;
export const LIGHT_MINUTE_KM = C_KMS * 60;
export const DEG = Math.PI / 180;
/** Mean obliquity of the ecliptic at J2000. */
export const OBLIQUITY_J2000 = 23.4392911 * DEG;
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
export const DAY_MS = 86_400_000;

export const WARP_FACTORS = [1, 3, 10, 50, 100] as const;
export type WarpFactor = (typeof WARP_FACTORS)[number];
