import './api/tauriBridge';
import './index.css';
import '@/assets/css/mobile.css';
import 'animate.css';
import 'remixicon/fonts/remixicon.css';

import { createApp } from 'vue';

import i18n from '@/../i18n/renderer';
import router from '@/router';
import pinia from '@/store';
import { isElectron } from '@/utils';

import App from './App.vue';
import directives from './directive';
import { initRendererErrorMonitor } from './services/errorMonitor';

if (!isElectron && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[PWA] Service worker registration failed:', error);
    });
  });
}

const app = createApp(App);

Object.keys(directives).forEach((key: string) => {
  app.directive(key, directives[key as keyof typeof directives]);
});

app.use(pinia);
app.use(router);

// A failed lazy route or a crashed view must not leave a blank window.
router.onError((error) => {
  console.error('[router] navigation failed:', error);
  if (window.location.hash !== '#/') {
    window.location.hash = '#/';
  }
});
app.use(i18n as any);
initRendererErrorMonitor(app);
app.mount('#app');
