import type { CapacitorConfig } from '@capacitor/cli';

const DEV_SERVER = process.env.CAP_DEV === '1';

const PROD_URL = 'https://clubfuoco.vercel.app';

const config: CapacitorConfig = {
  appId: 'com.clubfuoco.app',
  appName: 'Club Fuoco',
  webDir: 'out',

  server: DEV_SERVER
    ? {
        // Dev: point at local Next.js server (Mac LAN IP so iPhone can reach it)
        url: 'http://192.168.1.173:3000',
        cleartext: true,
      }
    : {
        // Production: deployed Vercel app — no local server needed
        url: PROD_URL,
        cleartext: false,
      },

  ios: {
    contentInset: 'always',
    backgroundColor: '#F8F5EE',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
