import { createDraftTool } from './src/draft-tool.mjs';
import { createStudioController } from './src/studio-controller.mjs';
import { startStudioProxy } from './src/studio-proxy.mjs';

export const inject = ['tools', 'connection', 'webServer', 'llm', 'agentDefaultModel', 'storageDomain', 'sessionController', 'systemPrompt', 'agents'];

/** Register a pure, unsaved project draft operation for the active Agent. */
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(createDraftTool()), 'openfilm: draft tool');
  ctx.effect(() => createStudioController(ctx, startStudioProxy, { officialShell: process.env.NO996_OPENFILM_DSH_CHAT !== '1' }), 'openfilm: Studio');
}
