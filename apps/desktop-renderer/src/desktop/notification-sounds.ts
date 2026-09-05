import {
  isDesktopNotificationSound,
  type DesktopNotificationSound,
} from "@workbench/desktop-contracts";

// Locally synthesized tones need no downloads or platform-specific sound files.
// Each note is [frequency, end frequency, start offset, duration, volume].
const NOTES = {
  chime: [
    [784, 784, 0, 0.3, 0.13],
    [1047, 1047, 0.16, 0.5, 0.11],
  ],
  soft: [
    [440, 440, 0, 0.55, 0.09],
    [554, 554, 0.1, 0.6, 0.06],
  ],
  bell: [
    [880, 880, 0, 0.8, 0.12],
    [1760, 1760, 0, 0.55, 0.035],
  ],
  droplet: [
    [1400, 500, 0, 0.22, 0.12],
    [1100, 400, 0.25, 0.25, 0.08],
  ],
} as const satisfies Record<DesktopNotificationSound, readonly (readonly number[])[]>;

let activeContext: AudioContext | undefined;

export function stopNotificationSound() {
  const context = activeContext;
  activeContext = undefined;
  if (context && context.state !== "closed") void context.close().catch(() => {});
}

export async function playNotificationSound(sound: DesktopNotificationSound): Promise<void> {
  if (!isDesktopNotificationSound(sound)) throw new Error("invalid-notification-sound");
  stopNotificationSound();
  const context = new AudioContext();
  activeContext = context;
  try {
    await context.resume();
    if (activeContext !== context) return;
    let remaining = NOTES[sound].length;
    for (const [frequency, endFrequency, offset, duration, volume] of NOTES[sound]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + 0.02 + offset;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.linearRampToValueAtTime(endFrequency, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        if (--remaining === 0 && activeContext === context) stopNotificationSound();
      };
      oscillator.start(start);
      oscillator.stop(start + duration);
    }
  } catch (error) {
    if (activeContext === context) stopNotificationSound();
    throw error;
  }
}
