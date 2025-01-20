import {
  AgentOverChromeBridge,
  getBridgePageInCliSide,
} from '@/bridge-mode/agent-cli-side';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({
  testTimeout: 60 * 1000,
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
describe.skipIf(process.env.CI)(
  'fully functional agent in server(cli) side',
  () => {
    it('agent in cli side, new tab', async () => {
      const agent = new AgentOverChromeBridge();

      await agent.connectNewTabWithUrl('https://www.bing.com');
      await sleep(3000);

      await agent.ai('type "AI 101" and hit Enter');
      await sleep(3000);

      await agent.aiAssert('there are some search results');
      await agent.destroy();
    });
  },
);
