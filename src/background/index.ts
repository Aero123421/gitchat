// Service worker entry. Listeners must be registered synchronously on every start (MV3).
import { onSettingsChanged } from '../shared/settings';
import { createBackground } from './app';

const app = createBackground();

chrome.runtime.onMessage.addListener(app.onMessage);
chrome.runtime.onConnect.addListener(app.onConnect);
chrome.alarms.onAlarm.addListener(app.onAlarm);
chrome.runtime.onStartup.addListener(app.onStartup);
chrome.runtime.onInstalled.addListener(app.onInstalled);
onSettingsChanged(app.onSettingsStored);
