// Service worker entry. Restrict storage before registering listeners so a message cannot
// read, store, or use a token while content scripts can still see chrome.storage.
import { normalizeSettings, restrictSettingsStorage } from '../shared/settings';
import { createBackground } from './app';
import { restrictStorage } from './github/auth';

const restricted = await Promise.allSettled([restrictStorage(), restrictSettingsStorage()]);
const failures = restricted.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
if (failures.length > 1) throw new AggregateError(failures, 'Could not restrict extension storage to trusted contexts.');
if (failures.length === 1) throw failures[0];

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
