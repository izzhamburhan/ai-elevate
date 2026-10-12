import { ToolLoopAgent, isStepCount, type LanguageModel, type ToolSet } from "ai";

const BASE_INSTRUCTIONS = `You are Elevate, an assistant inside a geospatial map workspace built on kepler.gl.
Help the user explore and analyze their map data. Use the available tools when they help answer
the question, and say plainly when a request needs a tool you don't have.`;

type CreateAgentOptions = {
  model: LanguageModel;
  /** Backend tools (MCP) and frontend tools uploaded by assistant-ui, merged. */
  tools: ToolSet;
  /** Extra system text sent by the client (assistant-ui model context). */
  system?: string;
};

/** The chat agent: calls the model, runs tools, and loops until it has an answer. */
export function createElevateAgent({ model, tools, system }: CreateAgentOptions) {
  return new ToolLoopAgent({
    model,
    instructions: system ? `${BASE_INSTRUCTIONS}\n\n${system}` : BASE_INSTRUCTIONS,
    tools,
    stopWhen: isStepCount(10),
  });
}
