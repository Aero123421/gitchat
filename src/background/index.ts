// Service worker entry. Listeners must be registered synchronously on every start (MV3).
import { normalizeSettings } from '../shared/settings';
import { createBackground } from './app';
import { restrictStorage } from './github/auth';

void restrictStorage();
const app = createBackground();

chrome.runtime.onMessage.addListener(app.onMessage);
chrome.runtime.onConnect.addListener(app.onConnect);
chrome.alarms.onAlarm.addListener(app.onAlarm);
chrome.runtime.onStartup.addListener(app.onStartup);
chrome.runtime.onInstalled.addListener(app.onInstalled);
// The previous value comes along: after a worker restart, it is what the change is compared against.
// The first save has none: compare against the defaults it replaced.
chrome.storage.onChanged.addListener((changes, area) => {
  const c = changes.settings;
  if (area === 'sync' && c) app.onSettingsStored(normalizeSettings(c.oldValue));
});
app.start();
