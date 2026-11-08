/*
  This file starts the Grok bot.

  The bot does not search Gmail itself. Another part of the project already
  found a keyword. This file only tells Grok which model to use when it writes
  the one-sentence alert. The rules for that sentence live in instructions.md.
*/
import { defineAgent } from "@grok/agent-sdk";

// Create the bot and choose a fast Grok model with light reasoning.
export default defineAgent({
  model: {
    id: "grok-4.7",
    params: [
      { id: "reasoning_effort", value: "low" },
      { id: "fast", value: "true" },
    ],
  },
});