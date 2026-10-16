// The game's connection to Claude: townsfolk conversations and the AI director's judgment.
//
// Turned on by setting ANTHROPIC_API_KEY on the server. Without it everything falls back to
// scripted behavior. Calls are rate limited per player and capped per day, and every reply is
// structured JSON validated against a schema, so the model can only choose among actions the
// game already allows - it never hands out items or credits on its own.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.NPC_MODEL || 'claude-opus-5-5';
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 3000;
const MAX_CONCURRENT = 6;

export class AI {
  constructor(log = () => {}) {
    this.log = log;
    this.enabled = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.AI_DISABLED !== '1';
    this.client = this.enabled ? new Anthropic() : null;
    this.inFlight = 0;
    this.day = 0;
    this.used = 0;
    this.stats = { calls: 0, failures: 0, refusals: 0, inputTokens: 0, outputTokens: 0 };
  }

  // Room for another call right now (concurrency and the daily cap)?
  available() {
    const day = Math.floor(Date.now() / 86400000);
    if (day !== this.day) { this.day = day; this.used = 0; }
    return this.enabled && this.inFlight < MAX_CONCURRENT && this.used < DAILY_LIMIT;
  }

  // One structured call: returns the parsed JSON object, or null on any failure.
  async json({ system, messages, schema, effort = 'low', maxTokens = 2000 }) {
    if (!this.available()) return null;
    this.inFlight++;
    this.used++;
    this.stats.calls++;
    try {
      const response = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
        output_config: { effort, format: { type: 'json_schema', schema } },
      }, { timeout: 30000 });
      this.stats.inputTokens += response.usage?.input_tokens || 0;
      this.stats.outputTokens += response.usage?.output_tokens || 0;
      if (response.stop_reason === 'refusal') { this.stats.refusals++; return null; }
      const text = response.content.find((b) => b.type === 'text')?.text;
      if (!text) return null;
      return JSON.parse(text);
    } catch (e) {
      this.stats.failures++;
      if (e instanceof Anthropic.RateLimitError) this.log('AI rate limited');
      else if (e instanceof Anthropic.AuthenticationError) { this.log('AI key rejected; turning AI off'); this.enabled = false; }
      else if (e instanceof Anthropic.APIError) this.log(`AI error ${e.status}: ${e.message}`);
      else this.log('AI call failed:', e.message);
      return null;
    } finally {
      this.inFlight--;
    }
  }
}
