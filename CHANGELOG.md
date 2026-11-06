# Change Log

## v2.2.5

* Fix: account/password login now uses LG's server-side signature endpoint; LG removed the `searchKey` endpoint that returned the signing key.
* Fix: `thinq auth` uses the redirect URI LG accepts (`https://kr.m.lgaccount.com/login/iabClose`) instead of the plugin's own URI, which LG rejects.
* Fix: stop calling LG's retired `common/showTerms` endpoint. When LG asks for new terms, the plugin now tells you to accept them in the LG ThinQ app instead.
* Docs: explain the new-term acceptance flow.

## v2.2.4

* Fix: `thinq login` no longer prints the account password to the terminal.
* Fix: accepting LG's new terms now uses the account's configured country and language instead of LG's Vietnam (`VN` / `en-VN`) endpoint.
* Fix: the AC settings screen now exposes `ac_led_control`.
* Fix: the Range settings section no longer describes itself as dishwasher settings.
* Fix: the settings schema now lists every supported device type and no longer advertises `RANGE`/`COOKTOP`, which the plugin cannot handle.
* Docs: README corrected against the code (auth precedence, Burners/Range, support table, install options, engine requirements).

## v2.2.3

* Fix: when `refresh_interval` is not set, devices are polled every 60 seconds (the settings UI default) instead of every 5 seconds. The settings UI only shows this option with ThinQ1 enabled, so most setups were polling LG every 5 seconds.
* Docs: the README now covers sign-in options and every per-device option, replacing links to the upstream wiki; install from npm.
* The settings screen links to this README instead of the upstream wiki.
* The npm package no longer includes tests, sample data or lint config.

## v2.2.2

* Fix: errors that could restart the whole Homebridge child bridge are now caught and logged (Homebridge shuts the bridge down on any uncaught exception, including unhandled promise rejections):
  * a device command that fails (network error, LG API error) on any appliance;
  * an MQTT message that is not valid JSON, or that a device fails to apply;
  * a failed MQTT reconnect (it now keeps retrying every 60 seconds instead of giving up);
  * a failed backup poll, or a failed device unregister.
* ThinQ1 polling errors other than "manual process needed" are now logged instead of silently ignored.
* `@typescript-eslint/no-floating-promises` and `no-misused-promises` are now lint errors.

## v2.2.1

* Platform decisions moved into pure, unit-tested functions (`src/platformLogic.ts`): which devices are published, config name overrides, which accessories (and UUIDs) each device gets, service name prefixes, and keeping the cache when LG returns no devices.
* Fix: an appliance name ending or starting with punctuation (e.g. "Oven (Upper)") was prefixed onto its service names again on every restart.
* Microwave: all loose `==`/`!=` comparisons replaced with strict ones (LG fields are converted with `Number()` first, so behavior is unchanged); its time fields are summed as numbers via the shared `hmsSeconds`. `eqeqeq` is now a lint error.
* Microwave fixes found with a spoofed microwave in tests (`test/microwave.test.mjs`): power level showed NaN when LG omitted it, and status updates pushed the raw 0-10 level instead of a percentage; temperature fields sent as strings were misread ("0" became -18 C); thermostat temperatures are kept within HomeKit's range, and setup no longer logs illegal-value warnings.

## v2.2.0

* Washer/dryer logic moved into pure, unit-tested functions (`src/devices/washerDryerLogic.ts`); the accessory class only wires them to HomeKit.
* "Program Finished" fires only when a program completes (END, or dryer COOLDOWN; or power-off with a minute or less left), once per program. Stopping, cancelling, powering off mid-cycle, pausing or an error no longer trigger it, repeated end messages do not re-trigger it, and restarts are handled (a restart mid-program still reports the finish; a restart after it does not).
* A missing `state` in LG's status is treated as off; it was treated as running.
* Washer/dryer states classified from real LG device models: dryer WRINKLECARE and washer REFRESHING after a cycle no longer look like a new program (which could send a second alert); freeze prevention (FROZEN_PREVENT_*) and delayed start (RESERVED) are not programs; RINSEHOLD and AUTO_DT_OPEN_PAUSE are pauses; ERROR_AUTO_OFF is an error.
* Dishwasher rewritten as thin HomeKit wiring over pure, tested rules (`dishwasherLogic.ts`): on/running (a delayed start that has not begun is not "in use"), time left, program length, door, rinse-aid level. The unpublished Television/status-text code was removed (791 to 189 lines); the published valve, door and Program Finished services are unchanged.
* Ranges: the cooktop is a separate "Burners" accessory (name configurable with `burners_name`) with one read-only switch that is on while any burner is on. LG does not report which physical burner is on (its cooktop numbers are not positions), and does not allow remote burner control. The oven no longer has the "Range is Cooking" and "Number of Burners in Use" parts.
* Oven rewritten as thin HomeKit wiring over pure, tested rules (`ovenLogic.ts`), same published services (1837 to 288 lines). Fixes: mode switches always read as off and their state logic was inverted while cooking (now: the mode being cooked, else the mode selected for the next start); Air Sous-vide in Celsius always sent 38 C; the probe "heating" state checked a misspelled field and was on whenever a probe reading existed; setup could throw before the first status. Unpublished Television/status text/timer code removed.
* Dishwasher "Program Finished" uses the same rules (shared `programTracking.ts`): once per program at completion, not on stop/cancel/power cut, restarts handled; the model's own state values are used.
* Washers/dryers that LG reports offline still show as off, and now also raise the HomeKit fault flag.
* Washers/dryers publish the program length (SetDuration); without it the Home app showed "Waiting..." instead of a countdown.

## v2.1.0

* Requires Homebridge 2 and Node.js 22.12+ (same as Homebridge core).
* Removed the unused `homebridge-config-ui-x` dependency and updated axios, axios-retry, plugin-ui-utils, luxon, qs and node-forge; `uuid` replaced by `node:crypto`. Production audit: 36 advisories (4 critical, 22 high) down to 5 moderate in mqtt's CLI tooling.
* Fixed oven and microwave cooking-mode switches, which compared instead of setting the mode, so selecting a mode never took effect.
* Fixed setup crashes when LG sends a status without a section (washer door lock, refrigerator modes, dishwasher state).
* All characteristic handlers use Homebridge's `onGet`/`onSet`.
* Added tests (node:test with the real HAP-NodeJS library) and CI on Node 22/24/26; releases are published from version tags.
* Removed the upstream maintainer's donation link from the repository.

## v2.0.0

* Published as `@rnikoopour/homebridge-lg-thinq` (rnikoopour's maintained fork of nVuln/homebridge-lg-thinq, based on 1.8.11). Breaking: the package name changed. Existing installs of `homebridge-lg-thinq` keep their accessories only if the cached accessories are relabelled to the new plugin name before the first start (see README).
* Persisted ThinQ device data stays under `homebridge-lg-thinq/` in the Homebridge storage path, so it is reused.
* Includes the unreleased 1.9.2 changes: prefixed Name/ConfiguredName on every secondary service, faucet-type dishwasher valve, oven timer valves no longer published, dishwasher/oven services linked to their primary service.

## v1.9.1

* Names are published only through each service's Name (set from the Homebridge config), like homebridge-pihole. The writable ConfiguredName characteristic is no longer published and is stripped from cached accessories.

## v1.9.0

Maintained fork based on upstream v1.8.11 (the v2 rewrite is not used).

* Kept cached accessories when ThinQ returns an empty device list, instead of removing every appliance and with it every HomeKit automation that referenced them.
* Device names come from the Homebridge config, and restored accessories are renamed to match.
* Dishwasher and Oven no longer publish a Television service (shown as "TV" in the Home app): the dishwasher valve and the oven thermostat are the main tiles.
* Sent a browser User-Agent so LG's preLogin endpoint no longer returns 403 (upstream PR #400).
* Allowed Node 24.

## v1.8.0

### Washer is fixed now

* Washer should be appear in Home app now, so sorry for my mistake in previous version.
* Reset Homebridge accesssory cache is required to make it work.

### New Device Supported

* New kind of washer is supported also (device type 223)

## v1.7.0

- fix: washer service name  a9fa96a
- fix: air purifier service name  6a7937f
- fix: refrigerator service name  4faca7f
- fix: AC warning message  b53642d
- add: refrigerator water filter status #260  d0ef884
- fix: dishwasher crashed #270  7efddaf
- fix: AC temperature not updated #177  e934f81
- revert: server.js in custom UI  e11b2a6
- fix: retrieve sale model if possible #275  d6df494

## v1.6.0

### New Device Supported

* Oven
* Microwave

## v1.5.0

### IMPORTANT: AC temperature unit need to be set in plugin setting

- if your AC is in Fahrenheit, please change it in plugin setting to make sure the temperature value is correct, otherwise it will be converted to Celsius by default.
- in previous version, the temperature unit is auto detected, but it's not reliable, so we have to change it to manual setting.

## v1.4.0

- fix: AC humidity value on some device #224  c4227b4
- add: custom characteristic for AC energy consumption #222  6b36c7a
- add: dishwasher data sample  3805ce1
- enable refrigerator door sensor on thinq 1  1d99daf
- fix: Washer tub clean coach event triggered multiple times  aaa8920

## v1.3.0

### New Device Supported

* Range Hood
* AeroTower

### Bug fixes

* Air Conditioner fahrenheit unit (US region)
* Washer/Dryer as water faucet appear again on ios 16

### New feature

* Filter status on Air Purifier
* Tub clean event on Washer/Dryer (trigger at 30 cycle)

## v1.2.0

### Changes

* Real-time device data update via MQTT (thinq2 only)
* More device support

### Bug fixes

* Update login workflow: preLogin step

### Other Changes

* Washer door lock disable by default, need enable it in plugin setting
* Refrigerator: Express Freezer (Ice Plus), Express Fridge, Eco Friendly
* UI device list: changed to tabarray

## v1.1.0

### Changes

* AC supported
* Refrigerator thinq1

### Bug fixes

* washer program finished trigger (as Occupancy Sensor)
* thinq1 device monitor

## v1.0.0

### stable release

* config UI with 3rd party login support (Google, Facebook ...)
* devices support: Air Purifier, Dehumidifier, Dishwasher, Refrigerator, Washer & Dryer
* more device support in future
