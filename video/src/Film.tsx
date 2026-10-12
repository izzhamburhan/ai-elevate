import type { FC } from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";

import { C, beatFrame, beatsFrom } from "./kit";
import {
  S0Opening,
  S1Logo,
  S2Exposure,
  S3Unpack,
  S4Scale,
  S5Map,
  S6Simulate,
  S7Signals,
  S8Connect,
  S9Plan,
  S10Tackle,
  S11History,
  S12Evidence,
  S13Outro,
} from "./scenes";

/**
 * Scene starts in song beats (see BEAT in kit), following the Gemini 3 ad's pacing but snapped to the song:
 * the intro hit at 5.5, the drop at 10, the accent hits, the breakdown at 41, the return just before 45,
 * and the final drop at 68 after the silence. The last entry is the end of the film.
 */
const CUTS = [0, 5.5, 10, 17, 23, 29, 31, 37, 41, 44.75, 49, 55, 61, 68, 83];
const SCENES = [S0Opening, S1Logo, S2Exposure, S3Unpack, S4Scale, S5Map, S6Simulate, S7Signals, S8Connect, S9Plan, S10Tackle, S11History, S12Evidence, S13Outro];

const start = (i: number) => (i === 0 ? 0 : beatFrame(CUTS[i]));

export const DURATION = start(CUTS.length - 1);

export const Film: FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    <Audio src={staticFile("song.mp3")} />
    {SCENES.map((Scene, i) => {
      const from = start(i);
      const d = start(i + 1) - from;
      return (
        <Sequence key={i} from={from} durationInFrames={d} name={Scene.name}>
          <Scene d={d} {...beatsFrom(CUTS[i], from)} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
