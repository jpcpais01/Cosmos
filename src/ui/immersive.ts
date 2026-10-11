/** Phones and tablets: full screen, held in landscape. */

const TOUCH = matchMedia('(pointer: coarse)').matches;

/**
 * Goes full screen and locks the screen to landscape where the browser allows it (Android
 * Chrome). iPhone Safari has neither, so there the rotate prompt does the job.
 */
export async function enterImmersive(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  } catch {
    /* refused or unsupported */
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* only allowed in full screen or an installed app */
  }
}

/**
 * On touch screens, turn landscape on the very first touch anywhere (loading and title screens
 * included), since browsers only allow it in response to a tap. Coming back to the app after
 * switching away drops full screen, so the next touch after that tries again.
 */
export function immersiveOnFirstTouch(): void {
  if (!TOUCH) return;
  let armed = true;
  // touchend / pointerup are the touch events that count as a user gesture (pointerdown doesn't)
  const onTouch = () => {
    if (!armed) return;
    armed = false;
    void enterImmersive();
  };
  window.addEventListener('touchend', onTouch, { capture: true, passive: true });
  window.addEventListener('pointerup', onTouch, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !document.fullscreenElement) armed = true;
  });
}
