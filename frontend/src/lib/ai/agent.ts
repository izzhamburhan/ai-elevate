import { ToolLoopAgent, isStepCount, type LanguageModel, type ToolSet } from "ai";

import { CAPABILITY_GAP_TOOL } from "@/lib/ai/capability-gaps";

const BASE_INSTRUCTIONS = `You are Elevate, an assistant inside a geospatial map workspace built on kepler.gl.
Help the user explore and analyze their map data. Use the available tools when they help answer
the question, and say plainly when a request needs a tool you don't have. Whenever you have to say that
(a tool, data source or capability is missing, unavailable or failed), first call ${CAPABILITY_GAP_TOOL} once.
Only offer what your tools can do now; never promise a capability that has no tool here.
Keep synthetic data and scenarios clearly labeled synthetic.`;

/**
 * Guidance for one group of tools, given to the model only when the group is there: naming a tool
 * the agent doesn't have makes it promise (or try) things it can't do. A server started with
 * --search lists only `<server>_search_tools` and `<server>_call_tool`, so that pair counts too.
 */
type ToolGuide = {
  tools: string[];
  server?: string;
  /** Its results render as a card in the answer. */
  card?: boolean;
  text: string;
};

const TOOL_GUIDES: ToolGuide[] = [
  {
    tools: ["predict_rainfall", "predict_temperature", "get_weather_forecast_geojson"],
    text: `The Weather ML tools predict_rainfall, predict_temperature and get_weather_forecast_geojson come from local
Chronos ML inference. Identify historical replay versus live inference, observation freshness, forecast valid times,
units, model/source provenance, and warnings. Never call experimental predictions official meteorological forecasts.
Forecast quantiles are not calibrated rainfall-event probabilities. If inference is unavailable, report that
limitation without inventing values. Use weather GeoJSON with the existing map tools when requested.`,
  },
  {
    tools: ["show_area"],
    card: true,
    text: `For any question about towers, people, trails or app usage in a place, town, district or radius, call show_area:
it draws the place on the map and shows an interactive card, so do not list the towers yourself.`,
  },
  {
    tools: ["run_self_heal"],
    card: true,
    text: "To heal or fix a faulty tower, an outage or the flood incident, call run_self_heal.",
  },
  {
    server: "netintel",
    card: true,
    tools: [
      "investigate_customer_complaint",
      "analyze_network_congestion",
      "correlate_network_incidents",
      "assess_weather_network_exposure",
      "recommend_network_maintenance",
    ],
    text: `For a customer complaint, congestion, several sites degrading together, weather exposure of sites or maintenance
advice, use the network intelligence tools (investigate_customer_complaint, analyze_network_congestion,
correlate_network_incidents, assess_weather_network_exposure, recommend_network_maintenance): their result is shown as
a card and drawn on the map. Present causes as plausible, with their evidence, never as proven. Weather exposure
describes geographic exposure, not actual telecom outages.`,
  },
  {
    server: "mlpredict",
    card: true,
    tools: [
      "predict_area_footfall",
      "rank_business_locations",
      "predict_site_failure_risk",
      "forecast_network_congestion",
      "detect_network_anomalies",
    ],
    text: `For forecasts (crowds or footfall, booth locations, site outage risk, congestion ahead, anomalies) use the
predictive ML tools (predict_area_footfall, rank_business_locations, predict_site_failure_risk,
forecast_network_congestion, detect_network_anomalies); give the numbers with their uncertainty and say they come
from local models trained on synthetic data.`,
  },
];

const CARD_RULE = `Answer with cards where there is one. A card already draws its result on the map, so do not redraw it or
move the map afterwards. After a card, add one or two sentences at most.`;

export type OfflineConnector = { name: string; description?: string };

function hasGuideTools(guide: ToolGuide, toolNames: Set<string>) {
  return guide.tools.some((t) => toolNames.has(t)) || (guide.server != null && toolNames.has(`${guide.server}_call_tool`));
}

/** The system prompt for the tools this turn actually has. */
export function elevateInstructions(tools: ToolSet, offline: OfflineConnector[] = []): string {
  const toolNames = new Set(Object.keys(tools));
  const guides = TOOL_GUIDES.filter((g) => hasGuideTools(g, toolNames));
  const parts = [BASE_INSTRUCTIONS, ...guides.map((g) => g.text)];
  if (guides.some((g) => g.card)) parts.push(CARD_RULE);
  if (offline.length) {
    const list = offline.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`).join("\n");
    parts.push(`These connectors are switched on but could not be reached, so their tools are missing this turn:
${list}
If a request needs one of them, say that connector is offline right now rather than that the capability doesn't exist.`);
  }
  return parts.join("\n\n");
}

type CreateAgentOptions = {
  model: LanguageModel;
  /** Backend tools (MCP) and frontend tools uploaded by assistant-ui, merged. */
  tools: ToolSet;
  /** Enabled MCP servers that failed to connect this turn. */
  offline?: OfflineConnector[];
  /** Extra system text sent by the client (assistant-ui model context). */
  system?: string;
};

/** The chat agent: calls the model, runs tools, and loops until it has an answer. */
export function createElevateAgent({ model, tools, offline, system }: CreateAgentOptions) {
  const instructions = elevateInstructions(tools, offline);
  return new ToolLoopAgent({
    model,
    instructions: system ? `${instructions}\n\n${system}` : instructions,
    tools,
    stopWhen: isStepCount(10),
  });
}
