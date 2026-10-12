import type { CSSProperties, FC, ReactNode } from "react";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadNewsreader } from "@remotion/google-fonts/Newsreader";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const inter = loadInter("normal", { weights: ["400", "500"], subsets: ["latin"] });
const newsreader = loadNewsreader("normal", { weights: ["400"], subsets: ["latin"] });
const mono = loadGeistMono("normal", { weights: ["400"], subsets: ["latin"] });

export const FONT = { sans: inter.fontFamily, display: newsreader.fontFamily, mono: mono.fontFamily };

/** The portal's palette (frontend/DESIGN.md): night surfaces, snow text, one lavender accent. */
export const C = {
  bg: "#0d0b13",
  night: "#14111d",
  surface: "#1c1927",
  raised: "#25212f",
  snow: "#fafafa",
  muted: "#b3b0bf",
  faint: "#59566a",
  lavender: "#bd9fff",
};

export const FPS = 30;
/** Seconds to frames. */
export const sec = (s: number) => Math.round(s * FPS);

/** public/song.mp3's beat grid, measured from its onsets: 96 BPM, first beat 0.042 s in. */
export const BEAT = 60 / 96;
const FIRST_BEAT = 0.042;
/** Frames in one beat and one 16th note. */
export const BEAT_FRAMES = BEAT * FPS;
export const SIXTEENTH = BEAT_FRAMES / 4;
/** Song frame of beat k (fractions are off-beats: .5 is the "and", .25 a 16th). */
export const beatFrame = (k: number) => sec(FIRST_BEAT + k * BEAT);
/** Springs start this many frames early so they visibly land (≈50% in) on the beat. */
export const LEAD = 3;

/**
 * Beat timing inside a scene that starts on song beat `start`:
 * `b(n)` is when an entrance should start to land n beats in, `on(n)` is the exact frame of that beat.
 */
export const beatsFrom = (start: number, from: number) => ({
  on: (n: number) => beatFrame(start + n) - from,
  b: (n: number) => Math.max(0, beatFrame(start + n) - from - LEAD),
});
export type Beats = ReturnType<typeof beatsFrom>;

/** 0 → 1 spring that starts `at` frames into the current sequence. */
export const useEnter = (at: number, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping, mass: 0.6 } });
};

/** Slowly drifting, twinkling starfield like the original's background. */
export const Stars: FC<{ count?: number }> = ({ count = 160 }) => {
  const frame = useCurrentFrame();
  const colors = [C.lavender, "#6aa6ff", C.snow];
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, overflow: "hidden" }}>
      {Array.from({ length: count }, (_, i) => {
        const x = random(`x${i}`) * 1920;
        const speed = 0.1 + random(`v${i}`) * 0.4;
        const y = (random(`y${i}`) * 1180 - frame * speed + 1180) % 1180 - 50;
        const size = 1.5 + random(`s${i}`) * 2.5;
        const twinkle = 0.25 + 0.55 * Math.abs(Math.sin(frame / (25 + random(`t${i}`) * 40) + i));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: size,
              background: colors[i % 3],
              opacity: twinkle,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Fades a scene in and out over a couple of frames, so the new scene is fully up right on its cut beat. */
export const Scene: FC<{ duration: number; children: ReactNode; bg?: ReactNode }> = ({ duration, children, bg }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 2, duration - 3, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ opacity, fontFamily: FONT.sans, color: C.snow }}>
      {bg ?? <Stars />}
      {children}
    </AbsoluteFill>
  );
};

/** One headline word or phrase that springs up into place at frame `at`. */
export const Word: FC<{
  at: number;
  children: ReactNode;
  size?: number;
  accent?: boolean;
  style?: CSSProperties;
  out?: number;
}> = ({ at, children, size = 150, accent, style, out }) => {
  const frame = useCurrentFrame();
  const p = useEnter(at);
  const fade = out === undefined ? 1 : interpolate(frame, [out, out + 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        fontSize: size,
        fontWeight: 500,
        letterSpacing: "-0.035em",
        lineHeight: 1,
        whiteSpace: "nowrap",
        color: accent ? C.lavender : C.snow,
        opacity: p * fade,
        transform: `translateY(${(1 - p) * 40}px) scale(${0.96 + 0.04 * p})`,
        textShadow: "0 8px 40px rgba(0,0,0,.85)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

type From = "up" | "down" | "left" | "right";
const OFFSET: Record<From, [number, number]> = { up: [0, -120], down: [0, 120], left: [-160, 0], right: [160, 0] };

type Typed = { w: number; h: number; bg: string; lines: [y0: number, y1: number, x0: number, x1: number][] };

/** Text lines of each prompt capture in image pixels, measured from the captures' white text, plus the bubble colour. */
const TYPED: Record<string, Typed> = {
  "e02-question": { w: 280, h: 136, bg: "#25212f", lines: [[14, 28, 16, 259], [38, 52, 16, 233], [62, 76, 17, 251], [86, 100, 17, 240], [111, 124, 17, 185]] },
  "e03-question": { w: 292, h: 146, bg: "#25212f", lines: [[16, 30, 22, 205], [40, 51, 21, 237], [64, 78, 21, 265], [88, 99, 22, 248], [112, 126, 21, 233]] },
  "e04-question": { w: 292, h: 114, bg: "#25212f", lines: [[16, 27, 21, 241], [40, 51, 22, 248], [64, 75, 21, 259], [89, 102, 21, 178]] },
  "e06-question": { w: 292, h: 142, bg: "#25212f", lines: [[16, 30, 22, 250], [40, 51, 22, 229], [64, 75, 20, 250], [88, 102, 21, 232], [113, 123, 21, 67]] },
  "e07-question": { w: 292, h: 92, bg: "#25212f", lines: [[16, 27, 21, 244], [40, 54, 21, 264], [65, 78, 22, 205]] },
  "e09-question": { w: 590, h: 70, bg: "#25212f", lines: [[18, 32, 21, 545], [45, 56, 20, 252]] },
  "e10-question": { w: 140, h: 44, bg: "#25212f", lines: [[16, 27, 20, 121]] },
  "e11-question": { w: 590, h: 70, bg: "#25212f", lines: [[12, 26, 21, 534], [36, 50, 21, 410]] },
  "e12-question": { w: 292, h: 164, bg: "#25212f", lines: [[16, 27, 25, 227], [41, 51, 21, 244], [64, 75, 20, 267], [88, 102, 21, 249], [115, 123, 21, 261], [139, 150, 20, 186]] },
};

/**
 * Types a prompt capture out line by line: covers the untyped text in the bubble's colour and reveals one chunk
 * per 16th note from `start`, so the keystrokes ride the hi-hats. A caret follows, then blinks on the beat.
 */
const TypeOver: FC<{ t: Typed; start: number; beats: number }> = ({ t, start, beats }) => {
  const frame = useCurrentFrame();
  const steps = Math.round(beats * 4);
  const since = frame - start;
  const done = Math.floor(since / SIXTEENTH) + 1;
  const reveal = since < 0 ? 0 : Math.min(1, (done - 1 + Math.min(1, (since - (done - 1) * SIXTEENTH) / 1.5)) / steps);

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const total = t.lines.reduce((s, [, , x0, x1]) => s + x1 - x0, 0);
  let left = reveal * total;
  const covers = t.lines.map(([y0, y1, x0, x1], i) => {
    // Bands split the gaps between lines so the covers hide ascenders and descenders without overlapping.
    const top = i === 0 ? y0 - 6 : (t.lines[i - 1][1] + y0) / 2;
    const bottom = i === t.lines.length - 1 ? y1 + 6 : (y1 + t.lines[i + 1][0]) / 2;
    const typed = Math.max(0, Math.min(x1 - x0, left));
    left -= x1 - x0;
    // An untyped line's cover reaches a little further left to hide the text's antialiased edge.
    return { top, bottom, x: x0 + typed, from: typed > 0 ? x0 + typed : x0 - 4, x1 };
  });
  // The caret sits on the first line still being typed, or at the end of the last one.
  const typing = covers.findIndex(({ x, x1 }) => x < x1);
  const line = typing < 0 ? t.lines.length - 1 : typing;
  const c ={ x: covers[line].x, top: t.lines[line][0] - 2, bottom: t.lines[line][1] + 2 };
  const after = (since - steps * SIXTEENTH) / BEAT_FRAMES;
  const caretOn = since >= 0 && (after < 0 || (after < 2 && after % 1 < 0.5));
  return (
    <>
      {covers.map(({ top, bottom, x, from, x1 }, i) =>
        x < x1 ? (
          <div
            key={i}
            style={{ position: "absolute", left: pct(from, t.w), width: pct(x1 + 3 - from, t.w), top: pct(top, t.h), height: pct(bottom - top, t.h), background: t.bg }}
          />
        ) : null,
      )}
      {caretOn ? (
        <div
          style={{ position: "absolute", left: pct(c.x + 1, t.w), width: pct(2, t.w), top: pct(c.top, t.h), height: pct(c.bottom - c.top, t.h), background: C.lavender }}
        />
      ) : null}
    </>
  );
};

/**
 * A real capture from the Elevate workspace. Springs in from one side, drifts slowly while on screen,
 * optionally types itself out on the beat (prompts) or wipes in top-to-bottom (rows appearing).
 */
export const Shot: FC<{
  src: string;
  alt: string;
  x: number;
  y: number;
  w: number;
  at: number;
  from?: From;
  rotate?: number;
  wipe?: "type" | "rows";
  /** Rows wipe length in frames. */
  wipeFrames?: number;
  /** Typing length in beats; keystrokes start on the beat this shot lands on. */
  typeBeats?: number;
  card?: boolean;
  accentBorder?: boolean;
}> = ({ src, alt, x, y, w, at, from = "down", rotate = 0, wipe, wipeFrames = 24, typeBeats = 2, card, accentBorder }) => {
  const frame = useCurrentFrame();
  const p = useEnter(at);
  const [dx, dy] = OFFSET[from];
  const drift = Math.max(0, frame - at) * -0.08;
  const reveal =
    wipe === "rows"
      ? interpolate(frame - at, [0, wipeFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        })
      : 1;
  const clipPath = wipe === "rows" ? `inset(0 0 ${(1 - reveal) * 100}% 0)` : undefined;
  const typed = wipe === "type" ? TYPED[src] : undefined;
  const img = (
    <div style={{ position: "relative" }}>
      <Img src={staticFile(`shots/${src}.jpg`)} alt={alt} style={{ display: "block", width: "100%", borderRadius: card ? 14 : 18 }} />
      {typed ? <TypeOver t={typed} start={at + (at > 0 ? LEAD : 0)} beats={typeBeats} /> : null}
    </div>
  );
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        opacity: p,
        transform: `translate(${dx * (1 - p)}px, ${dy * (1 - p) + drift}px) rotate(${rotate}deg) scale(${0.94 + 0.06 * p})`,
        clipPath,
        ...(card
          ? {
              padding: 14,
              boxSizing: "border-box",
              borderRadius: 26,
              background: C.night,
              border: `1.5px solid ${accentBorder ? C.lavender : C.raised}`,
            }
          : {}),
        boxShadow: "0 50px 120px -50px rgba(0,0,0,.95)",
      }}
    >
      {img}
    </div>
  );
};

/** A full-bleed map capture with a slow push-in and a darkening gradient so text reads over it. */
export const MapBg: FC<{ src: string; alt: string; duration: number; dim?: number; side?: "left" | "none" }> = ({
  src,
  alt,
  duration,
  dim = 0.55,
  side = "left",
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, duration], [1.04, 1.14]);
  return (
    <AbsoluteFill style={{ backgroundColor: C.night, overflow: "hidden" }}>
      <Img
        src={staticFile(`shots/${src}.jpg`)}
        alt={alt}
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, opacity: 1 - dim * 0.6 }}
      />
      <AbsoluteFill
        style={{
          background:
            side === "left"
              ? "linear-gradient(90deg, rgba(20,17,29,.96) 0%, rgba(20,17,29,.62) 45%, rgba(20,17,29,.25) 100%)"
              : "rgba(20,17,29,.35)",
        }}
      />
    </AbsoluteFill>
  );
};

/** The Elevate mark: a four-point lavender spark. */
export const Spark: FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 1.5C12.9 7.6 16.4 11.1 22.5 12 16.4 12.9 12.9 16.4 12 22.5 11.1 16.4 7.6 12.9 1.5 12 7.6 11.1 11.1 7.6 12 1.5Z" fill={C.lavender} />
  </svg>
);

export const FinePrint: FC<{ at?: number }> = ({ at = 0 }) => {
  const p = useEnter(at);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 48, textAlign: "center", fontSize: 22, color: C.muted, opacity: p }}>
      Sequences shortened. Demo uses synthetic network data.
    </div>
  );
};
