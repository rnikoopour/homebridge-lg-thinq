/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'LGThinQ';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = '@rnikoopour/homebridge-lg-thinq';

/**
 * Directory (under the Homebridge storage path) for persisted ThinQ device data.
 * Kept at the original package name so existing data is reused after the rename.
 */
export const PLUGIN_STORAGE_DIR = 'homebridge-lg-thinq';
