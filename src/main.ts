import { registerSW } from 'virtual:pwa-register';
import { requestPersistentStorage } from './db';
import { startRouter } from './router';
import { logView } from './views/log';
import { historyView } from './views/history';
import { progressView } from './views/progress';
import { settingsView } from './views/settings';
import './styles.css';

registerSW({ immediate: true });
void requestPersistentStorage();

startRouter(
  document.getElementById('app')!,
  { log: logView, history: historyView, progress: progressView, settings: settingsView },
  'log',
);
