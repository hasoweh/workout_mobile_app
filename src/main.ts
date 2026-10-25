// Shared styles first, so each view's CSS (imported by the views below) can override them.
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { requestPersistentStorage } from './db';
import { mountRestTimer } from './components/rest-timer';
import { startRouter } from './router';
import { logView } from './views/log';
import { programView } from './views/program';
import { progressView } from './views/progress';
import { settingsView } from './views/settings';

registerSW({ immediate: true });
void requestPersistentStorage();
mountRestTimer();

// History now lives in the Log tab; keep old #/history links working.
const historyRedirect = (_root: HTMLElement, params: string[]) => location.replace(`#/log/${params[0] ?? ''}`);

startRouter(
  document.getElementById('app')!,
  { log: logView, program: programView, history: historyRedirect, progress: progressView, settings: settingsView },
  'log',
);
