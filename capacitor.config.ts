import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPhone app: the web build inside a thin native shell. The plan is in
 * docs/native-roadmap.md (Phase 1).
 *
 * Never set `server.url` here: it is for live reload only, and the app must
 * carry every file it needs.
 */
const config: CapacitorConfig = {
  appId: 'com.liamdaly.gymgo',
  appName: 'GymGo',
  webDir: 'dist',
  // The web view's own colour, behind the page and beyond its edges. Unset,
  // it is white, which flashes on launch and shows on overscroll.
  backgroundColor: '#0c0c0b',
  ios: {
    // The app's safe-area CSS does the work, exactly as it does on the
    // home-screen app, so the web view is not inset for it.
    contentInset: 'never',
    allowsLinkPreview: false,
  },
  plugins: {
    // Light text on the near-black ground. The config's types call `style`
    // Android-only, but the iOS plugin reads it (Capacitor/Plugins/SystemBars.swift).
    SystemBars: { style: 'DARK' },
  },
  experimental: {
    ios: {
      // `cap sync` rewrites CapApp-SPM/Package.swift with the project's
      // deployment target as `.iOS(.v26)`, which only exists from package
      // tools 6.2 (Xcode 26); the CLI's default of 5.9 would not parse it.
      spm: { swiftToolsVersion: '6.2' },
    },
  },
};

export default config;
