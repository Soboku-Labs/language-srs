import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
  type ConfigPlugin,
} from '@expo/config-plugins';

/**
 * Wires the home-screen widgets into the generated native projects.
 *
 * `expo prebuild` regenerates `ios/` and `android/` from scratch, so anything the
 * widgets need in those projects has to be expressed as a plugin rather than
 * edited by hand — hand edits survive exactly until the next prebuild. The Swift
 * and Kotlin sources live in `targets/` under version control and are copied in
 * here.
 *
 * What this plugin does, per platform:
 *
 * iOS
 *   - declares the App Group on the app target, so app and widget share a container
 *   - writes the group and key names into Info.plist, so neither side hard-codes them
 *   - copies the WidgetKit sources into `ios/<WidgetName>/` with their own
 *     Info.plist and entitlements
 *   - creates the widget extension target in the Xcode project
 *
 * Android
 *   - copies the Glance sources into the app module
 *   - writes the appwidget-provider XML for both widget sizes
 *   - registers the two receivers and the shared-preferences metadata in the manifest
 *   - adds the Glance dependency
 *
 * The iOS extension target is the one part that cannot be verified without Xcode.
 * If `expo prebuild` produces a project where the widget target is missing or
 * misconfigured, `docs/WIDGET.md` documents adding it through Xcode's
 * File > New > Target flow instead — the Swift sources and the shared-container
 * contract are unchanged either way.
 */

export interface WidgetPluginOptions {
  appGroup: string;
  prefsName: string;
  payloadKey: string;
  pendingKey: string;
  /** Name of the iOS widget extension target and its source directory. */
  widgetName?: string;
  /** Minimum iOS version for the extension. WidgetKit interactivity needs 17. */
  deploymentTarget?: string;
}

const DEFAULT_WIDGET_NAME = 'LanguageSRSWidget';
const DEFAULT_DEPLOYMENT_TARGET = '16.0';

const withWidgets: ConfigPlugin<WidgetPluginOptions> = (config, options) => {
  const resolved = {
    widgetName: DEFAULT_WIDGET_NAME,
    deploymentTarget: DEFAULT_DEPLOYMENT_TARGET,
    ...options,
  };

  config = withAppGroupEntitlement(config, resolved);
  config = withSharedKeysInInfoPlist(config, resolved);
  config = withIosWidgetSources(config, resolved);
  config = withIosWidgetTarget(config, resolved);

  config = withAndroidWidgetSources(config, resolved);
  config = withAndroidWidgetManifest(config, resolved);
  config = withGlanceDependency(config, resolved);

  return config;
};

// ---------------------------------------------------------------- iOS

type Resolved = Required<WidgetPluginOptions>;

/** The App Group is what lets two sandboxed processes see the same UserDefaults. */
const withAppGroupEntitlement: ConfigPlugin<Resolved> = (config, options) =>
  withEntitlementsPlist(config, (modConfig) => {
    const key = 'com.apple.security.application-groups';
    const existing = (modConfig.modResults[key] as string[] | undefined) ?? [];
    if (!existing.includes(options.appGroup)) {
      modConfig.modResults[key] = [...existing, options.appGroup];
    }
    return modConfig;
  });

/**
 * Publish the group and key names to native code.
 *
 * Both the bridge module and the widget read these from Info.plist rather than
 * embedding literals, so changing the bundle id in `app.config.ts` propagates
 * instead of silently splitting the app and the widget across two containers.
 */
const withSharedKeysInInfoPlist: ConfigPlugin<Resolved> = (config, options) =>
  withInfoPlist(config, (modConfig) => {
    modConfig.modResults.LanguageSRSAppGroup = options.appGroup;
    modConfig.modResults.LanguageSRSWidgetPayloadKey = options.payloadKey;
    modConfig.modResults.LanguageSRSWidgetPendingKey = options.pendingKey;
    return modConfig;
  });

/** Copy the Swift sources and generate the extension's Info.plist and entitlements. */
const withIosWidgetSources: ConfigPlugin<Resolved> = (config, options) =>
  withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const source = path.join(projectRoot, 'targets', 'ios-widget');
      const destination = path.join(platformRoot, options.widgetName);

      fs.mkdirSync(destination, { recursive: true });

      for (const file of fs.readdirSync(source)) {
        if (!file.endsWith('.swift')) continue;
        fs.copyFileSync(path.join(source, file), path.join(destination, file));
      }

      fs.writeFileSync(
        path.join(destination, 'Info.plist'),
        widgetInfoPlist(options),
        'utf8',
      );

      fs.writeFileSync(
        path.join(destination, `${options.widgetName}.entitlements`),
        widgetEntitlements(options.appGroup),
        'utf8',
      );

      return modConfig;
    },
  ]);

function widgetInfoPlist(options: Resolved): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Language SRS</string>
  <key>CFBundleName</key>
  <string>${options.widgetName}</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
  <!-- Read by the widget instead of hard-coding the container identifiers. -->
  <key>LanguageSRSAppGroup</key>
  <string>${options.appGroup}</string>
  <key>LanguageSRSWidgetPayloadKey</key>
  <string>${options.payloadKey}</string>
  <key>LanguageSRSWidgetPendingKey</key>
  <string>${options.pendingKey}</string>
</dict>
</plist>
`;
}

function widgetEntitlements(appGroup: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${appGroup}</string>
  </array>
</dict>
</plist>
`;
}

/**
 * Add the widget extension target to the Xcode project.
 *
 * Creating a target means four linked things: the target itself, a build phase
 * with the Swift sources, a `PBXCopyFilesBuildPhase` on the app target that embeds
 * the built appex, and build settings pointing at the extension's Info.plist and
 * entitlements. Miss the embed phase and the widget builds cleanly but never
 * appears in the widget gallery, which is the failure mode this function exists to
 * avoid.
 */
const withIosWidgetTarget: ConfigPlugin<Resolved> = (config, options) =>
  withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const { widgetName } = options;

    // Idempotent: prebuild may run the mod more than once.
    if (project.pbxTargetByName(widgetName)) return modConfig;

    const bundleId = `${config.ios?.bundleIdentifier ?? 'com.languagesrs.app'}.${widgetName}`;

    const target = project.addTarget(widgetName, 'app_extension', widgetName, bundleId);

    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);

    const group = project.addPbxGroup(
      readSwiftFileNames(modConfig.modRequest.projectRoot),
      widgetName,
      widgetName,
    );

    // Hang the new group off the project root so it is visible in Xcode.
    const groups = project.hash.project.objects.PBXGroup;
    for (const key of Object.keys(groups)) {
      if (groups[key].name === undefined && groups[key].path === undefined && groups[key].children) {
        project.addToPbxGroup(group.uuid, key);
        break;
      }
    }

    for (const file of readSwiftFileNames(modConfig.modRequest.projectRoot)) {
      project.addSourceFile(`${widgetName}/${file}`, { target: target.uuid }, group.uuid);
    }

    // Embed the built extension in the app, or it never reaches the device.
    project.addBuildPhase(
      [`${widgetName}.appex`],
      'PBXCopyFilesBuildPhase',
      'Embed App Extensions',
      project.getFirstTarget().uuid,
      'app_extension',
    );

    applyWidgetBuildSettings(project, widgetName, options);

    return modConfig;
  });

function readSwiftFileNames(projectRoot: string): string[] {
  const source = path.join(projectRoot, 'targets', 'ios-widget');
  if (!fs.existsSync(source)) return [];
  return fs.readdirSync(source).filter((file) => file.endsWith('.swift'));
}

function applyWidgetBuildSettings(
  project: { pbxXCBuildConfigurationSection: () => Record<string, any> },
  widgetName: string,
  options: Resolved,
): void {
  const configurations = project.pbxXCBuildConfigurationSection();

  for (const key of Object.keys(configurations)) {
    const entry = configurations[key];
    const settings = entry?.buildSettings;
    if (!settings || settings.PRODUCT_NAME !== `"${widgetName}"`) continue;

    settings.INFOPLIST_FILE = `"${widgetName}/Info.plist"`;
    settings.CODE_SIGN_ENTITLEMENTS = `"${widgetName}/${widgetName}.entitlements"`;
    settings.IPHONEOS_DEPLOYMENT_TARGET = options.deploymentTarget;
    settings.TARGETED_DEVICE_FAMILY = '"1,2"';
    settings.SWIFT_VERSION = '5.0';
    settings.CURRENT_PROJECT_VERSION = '1';
    settings.MARKETING_VERSION = '1.0';
    settings.GENERATE_INFOPLIST_FILE = 'YES';
    settings.SKIP_INSTALL = 'YES';
  }
}

// ---------------------------------------------------------------- Android

/** Copy the Glance sources into the app module. */
const withAndroidWidgetSources: ConfigPlugin<Resolved> = (config, options) =>
  withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;

      const source = path.join(projectRoot, 'targets', 'android-widget');
      const destination = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'java',
        'com',
        'languagesrs',
        'app',
        'widget',
      );

      fs.mkdirSync(destination, { recursive: true });
      for (const file of fs.readdirSync(source)) {
        if (!file.endsWith('.kt')) continue;
        fs.copyFileSync(path.join(source, file), path.join(destination, file));
      }

      // appwidget-provider descriptors: sizing and update policy per widget.
      const xmlDir = path.join(platformRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(
        path.join(xmlDir, 'review_widget_info.xml'),
        appWidgetInfo({ minWidth: 250, minHeight: 110, resizeMode: 'horizontal|vertical' }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(xmlDir, 'spotlight_widget_info.xml'),
        appWidgetInfo({ minWidth: 110, minHeight: 110, resizeMode: 'none' }),
        'utf8',
      );

      return modConfig;
    },
  ]);

function appWidgetInfo(options: { minWidth: number; minHeight: number; resizeMode: string }): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="${options.minWidth}dp"
    android:minHeight="${options.minHeight}dp"
    android:targetCellWidth="4"
    android:targetCellHeight="2"
    android:resizeMode="${options.resizeMode}"
    android:widgetCategory="home_screen"
    android:initialLayout="@layout/glance_default_loading_layout"
    android:updatePeriodMillis="1800000" />
`;
}

/**
 * Register the receivers and the shared-preferences metadata.
 *
 * `updatePeriodMillis` in the XML is a floor Android enforces loosely and never
 * more often than every 30 minutes; the app's own `reloadWidgets` broadcast is what
 * makes updates feel immediate after a review.
 */
const withAndroidWidgetManifest: ConfigPlugin<Resolved> = (config, options) =>
  withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);

    application.receiver = application.receiver ?? [];
    application['meta-data'] = application['meta-data'] ?? [];

    const receivers: { name: string; label: string; info: string }[] = [
      {
        name: '.widget.ReviewWidgetProvider',
        label: 'Language SRS Review',
        info: '@xml/review_widget_info',
      },
      {
        name: '.widget.SpotlightWidgetProvider',
        label: 'Language SRS Word',
        info: '@xml/spotlight_widget_info',
      },
    ];

    for (const receiver of receivers) {
      const already = application.receiver.some(
        (entry) => entry.$?.['android:name'] === receiver.name,
      );
      if (already) continue;

      application.receiver.push({
        $: {
          'android:name': receiver.name,
          'android:label': receiver.label,
          // Exported so the launcher can bind the widget.
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': receiver.info,
            },
          },
        ],
      } as never);
    }

    const metadata: Record<string, string> = {
      'com.languagesrs.WIDGET_PREFS': options.prefsName,
      'com.languagesrs.WIDGET_PAYLOAD_KEY': options.payloadKey,
      'com.languagesrs.WIDGET_PENDING_KEY': options.pendingKey,
    };

    for (const [name, value] of Object.entries(metadata)) {
      const existing = application['meta-data'].find((entry) => entry.$?.['android:name'] === name);
      if (existing) {
        existing.$['android:value'] = value;
      } else {
        application['meta-data'].push({ $: { 'android:name': name, 'android:value': value } } as never);
      }
    }

    return modConfig;
  });

/** Glance and its Compose runtime are not part of the default Expo Android app. */
const withGlanceDependency: ConfigPlugin<Resolved> = (config) =>
  withAppBuildGradle(config, (modConfig) => {
    const marker = 'androidx.glance:glance-appwidget';
    if (modConfig.modResults.contents.includes(marker)) return modConfig;

    modConfig.modResults.contents = modConfig.modResults.contents.replace(
      /dependencies\s*\{/,
      `dependencies {
    // Home-screen widgets, added by plugins/withWidgets.ts
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.glance:glance-material3:1.1.1")`,
    );

    return modConfig;
  });

export default withWidgets;
