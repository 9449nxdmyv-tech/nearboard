import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.nearboard.app',
  appName: 'nearboard',
  webDir: 'build',
  server: {
    androidScheme: 'https'
  }
};

export default config;
