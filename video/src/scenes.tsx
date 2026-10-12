import type { CSSProperties, FC } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { BEAT_FRAMES, C, FONT, FinePrint, MapBg, SIXTEENTH, Scene, Shot, Spark, Word, useEnter } from "./kit";
import type { Beats } from "./kit";

/** Every scene gets its length and its beat clock: `b(n)` starts an entrance so it lands n beats in. */
type P = { d: number } & Beats;

/** A row of words that spring in one after another; words from `accentFrom` on are lavender. */
const Line: FC<{
  at: number;
  words: string[];
  size: number;
  accentFrom?: number;
  stagger?: number;
  out?: number;
  style?: CSSProperties;
}> = ({ at, words, size, accentFrom = words.length, stagger = 6, out, style }) => {
  const frame = useCurrentFrame();
  const fade = out === undefined ? 1 : interpolate(frame, [out, out + 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", display: "flex", gap: size * 0.26, opacity: fade, ...style }}>
      {words.map((w, i) => (
        <LineWord key={i} at={at + i * stagger} size={size} accent={i >= accentFrom}>
          {w}
        </LineWord>
      ))}
    </div>
  );
};

const LineWord: FC<{ at: number; size: number; accent: boolean; children: string }> = ({ at, size, accent, children }) => {
  const p = useEnter(at);
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 500,
        letterSpacing: "-0.035em",
        lineHeight: 1,
        whiteSpace: "nowrap",
        color: accent ? C.lavender : C.snow,
        opacity: p,
        transform: `translateY(${(1 - p) * 40}px)`,
        display: "inline-block",
        textShadow: "0 8px 40px rgba(0,0,0,.85)",
      }}
    >
      {children}
    </span>
  );
};

const center: CSSProperties = { left: 0, right: 0, justifyContent: "center", textAlign: "center" };

/** Positive remainder, for beat phases that start before a scene's first beat. */
const mod1 = (v: number) => ((v % 1) + 1) % 1;

// Beat numbers in the comments are song beats (Film's CUTS); odd beats carry the snare accents.

export const S0Opening: FC<P> = ({ d, b }) => (
  <Scene duration={d}>
    <Shot src="workspace" alt="Elevate workspace with chat and map" x={960} y={110} w={860} at={b(0)} from="right" rotate={-4} />
    <Shot src="status" alt="Network status popover" x={1560} y={440} w={300} at={b(0.75)} rotate={5} />
    <Shot src="e03-chart" alt="KKRI-0143 load chart" x={1000} y={600} w={380} at={b(2)} rotate={3} />
    <Shot src="e10-steps" alt="Self-heal steps card" x={640} y={560} w={320} at={b(3)} from="left" rotate={-3} />
    <Word at={b(0)} out={b(2) - 3} size={210} style={{ left: 130, top: 430 }}>Detect</Word>
    <Word at={b(2)} out={b(4) - 3} size={210} style={{ left: 130, top: 430 }}>Diagnose</Word>
    <Word at={b(4)} size={210} style={{ left: 130, top: 430 }}>Act</Word>
  </Scene>
);

export const S1Logo: FC<P> = ({ d, on }) => {
  const frame = useCurrentFrame();
  const name = "Elevate";
  // One letter per 16th, from the 16th after the cut; the cursor blinks on the beat.
  const shown = Math.max(0, Math.min(name.length, Math.floor((frame - on(0.25)) / SIXTEENTH) + 1));
  const cursor = frame < on(3.5) && mod1((frame - on(0.5)) / BEAT_FRAMES) < 0.5;
  return (
    <Scene duration={d}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 44 }}>
        <Spark size={150} />
        <div style={{ fontFamily: FONT.display, fontSize: 220, letterSpacing: "-0.035em", lineHeight: 1, minWidth: 700 }}>
          {name.slice(0, shown)}
          <span style={{ display: "inline-block", width: 8, height: 170, marginLeft: 18, background: C.lavender, opacity: cursor ? 1 : 0, verticalAlign: "-10px" }} />
        </div>
      </AbsoluteFill>
      <FinePrint at={6} />
    </Scene>
  );
};

/** Starts on the drop (beat 10): the chart lands on the snare at 13, the table on 14, the headline on 15. */
export const S2Exposure: FC<P> = ({ d, b }) => (
  <Scene duration={d} bg={<MapBg src="e02-map" alt="KKRI-0142 down in Kota Bharu" duration={d} />}>
    <Shot src="e02-question" alt="Which business customers are hit by the KKRI-0142 outage, and what SLA penalty will we owe over the next 2 hours?" x={90} y={70} w={380} at={b(0)} wipe="type" typeBeats={2} />
    <Shot src="e02-chart" alt="SLA exposure by affected business: already accrued vs the next 2 hours" x={90} y={290} w={430} at={b(3)} from="left" rotate={-2} card />
    <Shot src="e02-table" alt="Kuala Krai Cold Storage and Dabong Timber Mill: RM126.40 revenue at risk, RM910.00 penalty in the next 2 hours" x={1180} y={90} w={560} at={b(4)} from="right" rotate={2} card accentBorder />
    <Word at={b(4)} size={78} style={{ left: 1080, top: 560 }}>Know what&apos;s at stake</Word>
    <Word at={b(5)} size={160} style={{ left: 1080, top: 660 }}>Price every</Word>
    <Word at={b(5.5)} size={160} accent style={{ left: 1080, top: 820 }}>outage</Word>
  </Scene>
);

/** "Unpack" hits beat 21, the loudest snare in the song. */
export const S3Unpack: FC<P> = ({ d, b }) => (
  <Scene duration={d} bg={<MapBg src="e03-map" alt="Blast radius of KKRI-0142 on the map" duration={d} />}>
    <Shot src="e03-question" alt="Why is KKRI-0143 congested, and how is it linked to the KKRI-0142 outage?" x={90} y={70} w={380} at={b(0)} wipe="type" typeBeats={2} />
    <Shot src="e03-chart" alt="KKRI-0143 load rises as KKRI-0142 loses service" x={90} y={290} w={480} at={b(2)} from="left" rotate={-2} card />
    <Word at={b(3)} size={78} style={{ left: 1080, top: 560 }}>Learn anything</Word>
    <Word at={b(4)} size={160} accent style={{ left: 1080, top: 660 }}>Unpack</Word>
    <Word at={b(4.5)} size={160} accent style={{ left: 1080, top: 820 }}>incidents</Word>
  </Scene>
);

export const S4Scale: FC<P> = ({ d, b }) => (
  <Scene duration={d} bg={<MapBg src="e04-map" alt="Kota Bharu district boundary and towers" duration={d} />}>
    <Shot src="e04-question" alt="Where did the river overflow near Kota Bharu this morning?" x={90} y={60} w={380} at={b(0)} wipe="type" typeBeats={1.5} />
    <Shot src="e04-card" alt="Kota Bharu: 14 towers, 0 degraded, 1 down" x={90} y={240} w={440} at={b(1.5)} from="left" card />
    <Word at={b(2)} size={160} style={{ left: 1100, top: 150 }}>Visualize</Word>
    <Word at={b(4)} size={160} accent style={{ left: 1380, top: 780 }}>scale</Word>
  </Scene>
);

const MAPS = ["e03-map", "e04-map", "e07-map", "e12-map", "e10-map", "workspace"];

export const S5Map: FC<P> = ({ d, b }) => (
  <Scene duration={d}>
    <div style={{ position: "absolute", left: 60, top: 60, right: 60, bottom: 60, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(2, 1fr)", gap: 22 }}>
      {MAPS.map((m, i) => (
        <MapTile key={m} src={m} at={b(i / 8)} />
      ))}
    </div>
    <Line at={b(0.5)} words={["Map", "anything"]} accentFrom={1} size={170} stagger={BEAT_FRAMES / 2} style={{ ...center, top: 450 }} />
  </Scene>
);

const MapTile: FC<{ src: string; at: number }> = ({ src, at }) => {
  const p = useEnter(at);
  return (
    <div style={{ borderRadius: 24, overflow: "hidden", opacity: p * 0.7, transform: `scale(${0.9 + 0.1 * p})`, border: `1.5px solid ${C.raised}` }}>
      <Img src={staticFile(`shots/${src}.jpg`)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );
};

export const S6Simulate: FC<P> = ({ d, b }) => (
  <Scene duration={d}>
    <Line at={b(0)} words={["Simulate", "a", "tower", "failure"]} accentFrom={3} size={84} stagger={SIXTEENTH} style={{ left: 90, top: 80 }} />
    <Shot src="e06-question" alt="Simulate KKRI-0142 failing, then tilting KKRI-0143 and KKRI-0144" x={90} y={230} w={380} at={b(0.5)} wipe="type" typeBeats={1.5} />
    <Shot src="e06-reply" alt="Twin reports KKRI-0144 at 91% load; testing a 2 degree uptilt" x={90} y={440} w={460} at={b(2)} />
    <Shot src="e06-chart" alt="Twin: load before and after a 2 degree uptilt" x={1120} y={190} w={620} at={b(3)} from="right" rotate={2} card accentBorder />
    <Line at={b(4)} words={["Test", "a", "tilt", "change"]} accentFrom={3} size={96} stagger={SIXTEENTH} style={{ right: 90, top: 880 }} />
  </Scene>
);

export const S7Signals: FC<P> = ({ d, b }) => (
  <Scene duration={d} bg={<MapBg src="e07-map" alt="Street-level map of Kota Bharu" duration={d} />}>
    <Shot src="e07-question" alt="Rainfall, river gauges and power feeders around Kota Bharu" x={90} y={70} w={380} at={b(0)} wipe="type" typeBeats={1} />
    <Shot src="e07-chart" alt="Synthetic Kota Bharu hourly rainfall" x={90} y={220} w={470} at={b(1)} from="left" card />
    <Line at={b(2)} words={["Bring", "every"]} size={130} stagger={SIXTEENTH} style={{ left: 980, top: 340 }} />
    <Line at={b(3)} words={["signal", "to", "life"]} accentFrom={2} size={130} stagger={SIXTEENTH} style={{ left: 980, top: 490 }} />
  </Scene>
);

/** The breakdown (beat 41): one word per beat on the sparse pulse. */
export const S8Connect: FC<P> = ({ d, b }) => (
  <Scene duration={d}>
    <Shot src="connectors" alt="Connectors dialog grouped by topic" x={820} y={110} w={1000} at={b(0)} from="right" rotate={-3} />
    <Word at={b(0)} size={150} style={{ left: 110, top: 200 }}>Connect</Word>
    <Word at={b(1)} size={150} style={{ left: 330, top: 360 }}>tool</Word>
    <Word at={b(1.5)} size={150} style={{ left: 190, top: 520 }}>by</Word>
    <Word at={b(2)} size={150} accent style={{ left: 300, top: 680 }}>tool</Word>
  </Scene>
);

/** Cuts on the return a 16th before beat 45; the beat itself lands a 16th in. */
export const S9Plan: FC<P> = ({ d, b }) => (
  <Scene duration={d}>
    <Shot src="e09-question" alt="Forecast the Derby load and give me a capacity plan" x={700} y={50} w={760} at={b(0.25)} wipe="type" typeBeats={1} />
    <Shot src="e09-chart" alt="Derby: baseline vs scenario peak PRB" x={110} y={190} w={860} at={b(1.25)} from="left" rotate={-4} card />
    <Shot src="e09-plan" alt="Capacity plan: recover KKRI-0142, simulate downtilts, offload, prepare notices" x={880} y={560} w={900} at={b(2.25)} from="right" rotate={2} card accentBorder />
    <Line at={b(0.25)} words={["Plan", "anything"]} accentFrom={1} stagger={BEAT_FRAMES} size={150} style={{ left: 110, top: 840 }} />
  </Scene>
);

export const S10Tackle: FC<P> = ({ d, b }) => (
  <Scene duration={d} bg={<MapBg src="e10-map" alt="Self-heal incident drawn on the map" duration={d} dim={0.7} />}>
    <Word at={b(0)} size={170} style={{ left: 110, top: 110 }}>Tackle</Word>
    <Shot src="e10-question" alt="Heal KKRI-0142" x={130} y={330} w={200} at={b(0.5)} wipe="type" typeBeats={0.5} />
    <Shot src="e10-steps" alt="Self-heal steps: detect, diagnose, simulate, approve" x={120} y={410} w={380} at={b(1)} from="left" card />
    <Shot src="e10-approval" alt="Your approval is needed: tilt KKRI-0144 down by 4 degrees. Approve or reject." x={1330} y={120} w={470} at={b(2)} from="right" card accentBorder />
    <Line at={b(3)} words={["your", "outages"]} accentFrom={1} size={150} stagger={SIXTEENTH} style={{ left: 580, top: 860 }} />
  </Scene>
);

export const S11History: FC<P> = ({ d, b }) => (
  <Scene duration={d}>
    <Shot src="e11-question" alt="Walk me through the incident from 4 hours ago until now" x={820} y={60} w={760} at={b(0)} wipe="type" typeBeats={1} />
    <Shot src="e11-timeline" alt="Incident timeline 03:00 to 07:00: feeder trip, low battery, site down" x={800} y={170} w={920} at={b(1)} card wipe="rows" wipeFrames={4 * BEAT_FRAMES} />
    <Word at={b(2)} size={160} style={{ left: 110, top: 300 }}>Dive</Word>
    <Word at={b(3)} size={160} style={{ left: 190, top: 470 }}>into</Word>
    <Word at={b(4)} size={160} accent style={{ left: 240, top: 640 }}>history</Word>
  </Scene>
);

/** The words land on the last hits before the silence (beats 64.5–65.5), then hold through it. */
export const S12Evidence: FC<P> = ({ d, b }) => (
  <Scene duration={d} bg={<MapBg src="e12-map" alt="Evidence sites around Kota Bharu" duration={d} />}>
    <Shot src="e12-question" alt="Investigate exposed sites, correlate outages and complaints, recommend maintenance" x={90} y={60} w={380} at={b(0)} wipe="type" typeBeats={2} />
    <Shot src="e12-maint" alt="Maintenance recommendations: P1 chronic congestion at ED6444, ET7392, EC5528, ED4765" x={700} y={70} w={820} at={b(2)} from="right" rotate={-2} card />
    <Shot src="e12-chart" alt="Congested sector hours by site" x={1090} y={520} w={720} at={b(3)} from="right" rotate={3} card accentBorder />
    <Word at={b(3.5)} size={130} style={{ left: 100, top: 560 }}>Solve</Word>
    <Word at={b(4)} size={130} style={{ left: 100, top: 700 }}>challenges</Word>
    <Word at={b(4.5)} size={130} accent style={{ left: 100, top: 840 }}>with evidence</Word>
  </Scene>
);

/** Starts on the final drop (beat 68); the logo lands on beat 76. */
export const S13Outro: FC<P> = ({ d, b }) => {
  const logo = useEnter(b(8));
  return (
    <Scene duration={d}>
      <Line at={b(0)} words={["Detect", "Diagnose", "Act"]} size={140} stagger={BEAT_FRAMES / 2} out={b(3) - 3} style={{ ...center, top: 470 }} />
      <Word at={b(3)} out={b(4) - 3} size={400} style={{ ...center, top: 340 }}>Try</Word>
      <Line at={b(4)} words={["Try", "Elevate"]} size={170} stagger={SIXTEENTH} out={b(5) - 3} style={{ ...center, top: 455 }} />
      <Line at={b(5)} words={["and", "bring", "every"]} size={140} stagger={SIXTEENTH} out={b(8) - 3} style={{ ...center, top: 380 }} />
      <Line at={b(5.5)} words={["connection", "to", "life"]} accentFrom={2} size={140} stagger={SIXTEENTH} out={b(8) - 3} style={{ ...center, top: 540 }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 36, opacity: logo }}>
        <Spark size={110} />
        <div style={{ fontFamily: FONT.display, fontSize: 170, letterSpacing: "-0.035em" }}>Elevate</div>
      </AbsoluteFill>
    </Scene>
  );
};
