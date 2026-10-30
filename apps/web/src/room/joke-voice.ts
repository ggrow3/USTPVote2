import { reactive } from 'vue';

/**
 * The assistant joining the room's call to tell a lame joke (`/joke`, design §5.10). Nothing is sent for it: each page
 * in the call reads the joke out with the browser's own speech, and shows the assistant in the call, speaking, while
 * it does. It never listens; the call is not recorded or heard by anything.
 */

/** A joke's lines: the setup, then the punchline. */
export function jokeLines(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService' | 'default'>;

/** An English voice, one that runs on the device first (some browsers' others send the text to a server); else null. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return english.find((v) => v.localService && v.default) ?? english.find((v) => v.localService) ?? english[0] ?? null;
}

/** The pause between the setup and the punchline, and how long the assistant stays in the call after it. */
const BEAT_MS = 1100;
const LINGER_MS = 1500;

export class JokeVoice {
  /** `present` while the assistant is in the call for a joke, `speaking` while a line is being read. */
  readonly state = reactive({ present: false, speaking: false });
  private run = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Whether this browser can read a joke out at all. */
  static get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /** Reads `body` out: the setup, a beat, the punchline. A joke told meanwhile replaces it. */
  tell(body: string): void {
    if (!JokeVoice.supported) return;
    this.stop();
    const run = ++this.run;
    const lines = jokeLines(body);
    const voice = pickVoice(window.speechSynthesis.getVoices());
    this.state.present = true;
    const next = (i: number) => {
      if (run !== this.run) return;
      if (i >= lines.length) {
        this.timer = setTimeout(() => run === this.run && (this.state.present = false), LINGER_MS);
        return;
      }
      const u = new SpeechSynthesisUtterance(lines[i]!);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? 'en-US';
      u.onstart = () => run === this.run && (this.state.speaking = true);
      u.onend = u.onerror = () => {
        if (run !== this.run) return;
        this.state.speaking = false;
        this.timer = setTimeout(() => next(i + 1), i + 1 < lines.length ? BEAT_MS : 0);
      };
      window.speechSynthesis.speak(u);
    };
    next(0);
  }

  stop(): void {
    this.run++;
    clearTimeout(this.timer);
    if (JokeVoice.supported) window.speechSynthesis.cancel();
    this.state.present = false;
    this.state.speaking = false;
  }
}
