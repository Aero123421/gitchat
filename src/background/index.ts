// Register listeners synchronously; their work waits until storage is trusted-only.
import { isEnvelope } from '../shared/protocol';
import { normalizeSettings, restrictSettingsStorage } from '../shared/settings';
import { createBackground } from './app';
import { restrictStorage } from './github/auth';

const ready = Promise.allSettled([restrictStorage(), restrictSettingsStorage()]).then((restricted) => {
  const failures = restricted.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length > 1) throw new AggregateError(failures, 'Could not restrict extension storage to trusted contexts.');
  if (failures.length === 1) throw failures[0];
  return createBackground();
});

function run(fn: (app: ReturnType<typeof createBackground>) => void): void {
  void ready.then(fn).catch((error) => console.error('Could not initialize gitchat background.', error));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isEnvelope(msg) || sender.id !== chrome.runtime.id) return false;
  void ready.then((app) => app.onMessage(msg, sender, sendResponse)).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  // Keep the reply channel open while initialization is pending.
  return true;
});
chrome.runtime.onConnect.addListener((port) => {
  void ready.then((app) => app.onConnect(port)).catch(() => port.disconnect());
});
chrome.alarms.onAlarm.addListener((alarm) => run((app) => app.onAlarm(alarm)));
chrome.runtime.onStartup.addListener(() => run((app) => app.onStartup()));
chrome.runtime.onInstalled.addListener((details) => run((app) => app.onInstalled(details)));
// The previous value comes along: after a worker restart, it is what the change is compared against.
// The first save has none: compare against the defaults it replaced.
chrome.storage.onChanged.addListener((changes, area) => {
  const c = changes.settings;
  if (area === 'sync' && c) run((app) => app.onSettingsStored(normalizeSettings(c.oldValue)));
});
run((app) => app.start());
