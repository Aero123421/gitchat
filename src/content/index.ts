// Content script entry: runs on chatgpt.com, claude.ai and gemini.google.com (top frame only).
import { adapterFor } from './adapters/registry';
import { Controller } from './controller';
import { log } from '../shared/log';

const adapter = adapterFor(location.hostname);
if (adapter && window.top === window) {
  new Controller(adapter).start().catch((e) => log.error('failed to start', e));
}
