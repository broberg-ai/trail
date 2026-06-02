/** F190.3 runtime proof — ai.chat() tool-loop: model requests a tool, we feed
 *  the result back (Trail-owned loop), model produces a final answer. Proves the
 *  exact mechanic AiSdkChatBackend relies on. Needs an LLM key. */
import { ai } from '../src/lib/ai.js';

type Msgs = NonNullable<Parameters<typeof ai.chat>[0]['messages']>;
const tools = [{
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
}];
const primary = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', transport: 'http' as const };
const fallback = [{ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', transport: 'http' as const }];

const messages: Msgs = [{ role: 'user', content: 'What is the weather in Paris right now? Call the get_weather tool.' }];

let answer = '';
for (let turn = 0; turn < 4; turn++) {
  const res = await ai.chat({ system: 'You are a weather assistant. Use the tool when asked.', messages, tools, override: primary, fallback, maxTokens: 512, purpose: 'f190.3-verify' });
  console.log(`turn ${turn}: provider=${res.usage.provider} toolCalls=${res.toolCalls?.length ?? 0} textLen=${res.text?.length ?? 0}`);
  if (res.toolCalls && res.toolCalls.length > 0) {
    messages.push({ role: 'assistant', content: res.text ?? '', toolCalls: res.toolCalls });
    for (const tc of res.toolCalls) {
      console.log('  tool requested:', tc.name, JSON.stringify(tc.arguments));
      messages.push({ role: 'tool', toolCallId: tc.id, content: 'It is 18°C and sunny in Paris.' });
    }
    continue;
  }
  answer = res.text ?? '';
  break;
}
console.log('final answer:', JSON.stringify(answer));
if (!/18|sunny|sol/i.test(answer)) { console.error('✗ final answer did not use the tool result'); process.exit(1); }
console.log('✓ F190.3 tool-loop verified: toolCall → tool-result → final answer');
