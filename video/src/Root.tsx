import type { FC } from "react";
import { Composition } from "remotion";

import { DURATION, Film } from "./Film";
import { FPS } from "./kit";

export const Root: FC = () => (
  <Composition id="ElevateLaunch" component={Film} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
);
