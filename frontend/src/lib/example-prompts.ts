/**
 * One flood in Kota Bharu, asked as four questions in the order an operator would ask them, then a
 * plain tower lookup. The landing page's Ask section shows the first four and the workspace's empty
 * chat offers them all, so keep them answerable by the demo data. The flood is scripted in
 * backend/data/scenario/kuala_krai.yaml but the seed re-anchors it onto real NetOps sites in
 * Kota Bharu, keeping the KKRI-xxxx tower IDs.
 */
export const EXAMPLE_PROMPTS = [
  "Where did the river overflow near Kota Bharu this morning?",
  "Which sites and customers are at risk near KKRI-0142?",
  "Show 4G load on KKRI-0142's neighbour cells right now",
  "Send the nearest power crew to KKRI-0142",
  "List the towers in Cyberjaya",
] as const;
