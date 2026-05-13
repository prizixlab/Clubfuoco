import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.clubfuoco.app',
  appName: 'Club Fuoco',

  // The static export goes into /out — Capacitor bundles this into the app.
  // No server.url means the WebView loads files FROM THE DEVICE (true native).
  // API calls in the code detect capacitor: protocol and route to Vercel automatically.
  webDir: 'out',

  server: {
    // Changes the WKWebView host from "localhost" → "clubfuoco.app"
    // so iOS location/camera prompts read "clubfuoco.app" instead of "localhost"
    hostname: 'clubfuoco.app',
  },
  ios: {
    contentInset: 'always',
    backgroundColor: '#000000',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
