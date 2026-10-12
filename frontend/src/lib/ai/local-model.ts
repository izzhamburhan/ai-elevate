import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";

/** Opt-in compatibility setting for local thinking models; unset keeps the original model. */
export function configureLocalModel(
  model: Parameters<typeof wrapLanguageModel>[0]["model"],
  reasoningEffort?: string,
) {
  if (!reasoningEffort?.trim()) return model;
  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({
      settings: { providerOptions: { local: { reasoningEffort: reasoningEffort.trim() } } },
    }),
  });
}
