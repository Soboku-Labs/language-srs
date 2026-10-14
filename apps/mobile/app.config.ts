import type { ExpoConfig } from 'expo/config';

/**
 * Shared identifiers.
 *
 * The App Group and the SharedPreferences file name are the seam between the app
 * and the home-screen widgets: the app writes the payload there, the widget reads
 * it. They are declared once here and threaded through to the native code by the
 * config plugins, because a mismatch produces a widget that renders the empty
 * state forever with no error anywhere to explain why.
 */
export const BUNDLE_ID = 'com.subokulabs.mon';
export const APP_GROUP = `group.${BUNDLE_ID}`;
export const ANDROID_PREFS_NAME = 'mon_widget';
export const WIDGET_PAYLOAD_KEY = 'widget_snapshot';
export const WIDGET_PENDING_KEY = 'widget_pending_grades';
export const URL_SCHEME = 'mon';

const config: ExpoConfig = {
  name: 'Mon',
  slug: 'mon',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: URL_SCHEME,
  // Two themes are light and two are dark, and the app picks per language rather
  // than following the OS — so the system appearance setting is not consulted.
  userInterfaceStyle: 'automatic',

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    entitlements: {
      'com.apple.security.application-groups': [APP_GROUP],
    },
    infoPlist: {
      // Listening cards fall back to platform text-to-speech when an entry has
      // no recorded audio, which every seed entry currently is.
      UIBackgroundModes: ['audio'],
    },
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#0F172A',
    },
  },

  web: {
    bundler: 'metro',
    // Static export so the web build is a plain set of files any host can serve.
    output: 'static',
  },

  plugins: [
    /**
     * Route-level code splitting, web only.
     *
     * The web bundle is one file containing every screen, so opening the
     * dashboard downloads and parses the review session, the deck browser, the
     * import parser and the stats charts before anything renders. Async routes
     * make each screen its own chunk, fetched when it is first visited.
     *
     * Web only, and only in production: on native a single bundle is what you
     * want (there is no network between the app and its own code, and splitting
     * costs a round trip through the JS bridge), and in development the extra
     * requests slow Fast Refresh down for no benefit.
     */
    ['expo-router', { asyncRoutes: { web: 'production', default: false } }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0F172A',
        resizeMode: 'contain',
      },
    ],
    // Injects the WidgetKit extension and the Glance app widget, and wires both
    // to the shared container. See plugins/withWidgets.ts.
    [
      './plugins/withWidgets',
      {
        appGroup: APP_GROUP,
        prefsName: ANDROID_PREFS_NAME,
        payloadKey: WIDGET_PAYLOAD_KEY,
        pendingKey: WIDGET_PENDING_KEY,
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
    /**
     * Sub-path the web build is served from.
     *
     * GitHub Pages serves a project site at `/<repo>/`, not at the domain root,
     * so every asset URL and every router link has to carry that prefix. Set from
     * the environment rather than hard-coded, because the same build has to work
     * at the root for `expo start --web` and for any other host — a baked-in
     * `/language-srs` would break local development.
     */
    baseUrl: process.env.EXPO_WEB_BASE_URL ?? '',
  },

  extra: {
    appGroup: APP_GROUP,
    prefsName: ANDROID_PREFS_NAME,
    payloadKey: WIDGET_PAYLOAD_KEY,
    pendingKey: WIDGET_PENDING_KEY,
  },
};

export default config;
