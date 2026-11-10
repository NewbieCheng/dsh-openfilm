/** Adapt OpenFilm's text-only askAgent callback to the DSH default model.
 * This uses the Host's model service; provider credentials remain in DSH.
 * It is intentionally not a video/image generation adapter.
 */
export function createDshAskAgent({ llm, agentDefaultModel }) {
  if (!llm || !agentDefaultModel) throw new TypeError('DSH model services are required');
  return async function askAgent(prompt, signal) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 200_000) throw new Error('Invalid OpenFilm text request');
    const selection = agentDefaultModel.currentSelection();
    if (!selection?.provider || !selection?.model) throw new Error('No DSH default model is configured');
    let result = '';
    let finished = false;
    for await (const chunk of llm.stream({
      ...selection,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      signal,
    })) {
      if (chunk.type === 'text-delta') {
        result += chunk.text;
        if (result.length > 200_000) throw new Error('OpenFilm text response is too large');
      } else if (chunk.type === 'finish') {
        if (chunk.reason?.kind !== 'stop') throw new Error('DSH model did not complete the request');
        finished = true;
      }
    }
    if (!finished || !result.trim()) throw new Error('DSH model returned no text');
    return result;
  };
}
