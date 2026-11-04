<p align="center">
<img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>


# Homebridge LG ThinQ

> **Maintained fork** by [rnikoopour](https://github.com/rnikoopour) of [nVuln/homebridge-lg-thinq](https://github.com/nVuln/homebridge-lg-thinq) (Apache-2.0), based on upstream v1.8.11. See [CHANGELOG.md](CHANGELOG.md) for what changed. Published to npm as [`@rnikoopour/homebridge-lg-thinq`](https://www.npmjs.com/package/@rnikoopour/homebridge-lg-thinq).

## Overview

A Homebridge plugin that exposes supported LG ThinQ appliances to HomeKit for
control and monitoring.

⚠️ This plugin targets v2 of the LG ThinQ API. Some v1 devices are supported via
the `thinq1` option; see [Implementation Status](#implementation-status) for which
devices can be controlled and which are status-only.

This project is not affiliated with LG.

## Requirements

- Homebridge 2.x
- Node.js 22.12+, 24.x or 26.x

## Installation

Install it from the Homebridge UI: open **Plugins**, search for
`@rnikoopour/homebridge-lg-thinq`, and click **Install**. To install it from a
shell, run this in the Homebridge storage directory and restart Homebridge:

```
npm install @rnikoopour/homebridge-lg-thinq
```

Installing the package globally (`npm i -g`) only makes the `thinq` CLI available:
Homebridge loads plugins from its own storage `node_modules`, so a global install
does not register the plugin with Homebridge.

### LG terms of service

When LG publishes new terms for your account, the plugin accepts them automatically
so the integration keeps working (it logs "Handling new term agreement..." when it
does). If LG still returns no devices afterwards, cached accessories are kept rather
than removed; open the LG ThinQ app and restart Homebridge.

### Migrating from nVuln's `homebridge-lg-thinq`

This is the migration path from [nVuln's upstream package](https://github.com/nVuln/homebridge-lg-thinq),
`homebridge-lg-thinq`. The package name changed to `@rnikoopour/homebridge-lg-thinq`,
so Homebridge treats existing accessories as new (and HomeKit would drop their rooms
and automations).

Keep the accessories by relabeling the cache before Homebridge starts with the new
package:

1. Stop Homebridge.
2. In the Homebridge storage directory (as the user that runs Homebridge), install
   this package and remove the old one:
   ```
   npm install @rnikoopour/homebridge-lg-thinq
   npm uninstall homebridge-lg-thinq
   ```
3. Relabel the cached accessories. The main bridge uses `accessories/cachedAccessories`;
   a child bridge uses `accessories/cachedAccessories.<BRIDGE_USERNAME>`, where
   `<BRIDGE_USERNAME>` is the bridge username in uppercase with colons removed.
   Run this in the accessories directory, using the filename for your setup:
   ```
   jq '(.[] | select(.plugin == "homebridge-lg-thinq") | .plugin) = "@rnikoopour/homebridge-lg-thinq"' \
     cachedAccessories > tmp && mv tmp cachedAccessories
   ```
4. Start Homebridge.

The `LGThinQ` platform config is unchanged. Stored device data stays under
`homebridge-lg-thinq/`, so it is reused.

## Configuration

1. Open the Homebridge UI and go to the **Plugins** page.
2. Click the **Settings** button for the LG ThinQ plugin.
3. Log in to your LG account.
4. Select the devices you want to publish.
5. Restart Homebridge for the changes to take effect.

The settings screen writes the plugin config for you. These are the fields it manages:

- `auth_mode` Optional. `token` or `account`. Only controls which fields the settings screen shows; the plugin does not read it.
- `refresh_token` The refresh token of your account. Used whenever it is present, and takes precedence over `username`/`password`.
- `username` LG ThinQ account. Used when no `refresh_token` is set.
- `password` LG ThinQ password. Used when no `refresh_token` is set.
- `country` Required. Your account [country alpha-2 code](https://www.countrycode.org/), e.g., US for the USA.
- `language` Required. Your account language code, e.g., en-US, vi-VN.
- `devices` List devices you want to add to Homebridge; leave it empty to add all devices. See [Device configuration](#device-configuration).
- `thinq1` Optional. Enable ThinQ1 device support.
- `refresh_interval` Optional. Seconds between status polls (default 60): ThinQ1 devices rely on this polling, ThinQ2 devices use it as a backup in case real-time (MQTT) updates are missed. The plugin does not enforce a minimum; with ThinQ1 devices, keeping it above 30 seconds is recommended so LG does not rate-limit the account.
- `platform` value always `LGThinQ`

## Plugin Authorization Setting

The plugin signs in with an LG account: either a refresh token or a username and
password. If both are configured, the refresh token wins.

If your LG account uses Google, Apple, Facebook or Amazon sign-in, create a second LG
account with a username and password (it can use the same email; LG treats them
as separate accounts), share your home with it from the LG ThinQ app, and use the
second account in the plugin settings.

To avoid storing a password, use a `refresh_token` obtained from the bundled CLI
(the settings screen shows a "Refresh Token" field when `auth_mode` is `token`;
see [CLI Usage](#cli-usage)):

```
$ thinq login <username> <password> -c US -l en-US
Your refresh_token: ...
```

## Device configuration

Each entry in `devices` takes `id` (required), `name` (optional, overrides the LG
app name) and `serial_number` (optional, overrides the HomeKit Serial Number
characteristic). Device-specific options are off by default unless noted:

| Device | Option | Description |
| --- | --- | --- |
| Washer / Dryer / WashTower (including WashTower 2) | `washer_trigger` | "Program Finished" occupancy sensor for automations |
| | `washer_door_lock` | Door lock status (ThinQ2, when reported) |
| | `washer_tub_clean` | Tub clean event |
| Dishwasher | `dishwasher_trigger` | "Program Finished" occupancy sensor |
| Air conditioner | `ac_mode` | `COOLING`, `HEATING` or `BOTH` (default) |
| | `ac_swing_mode` | `VERTICAL`, `HORIZONTAL` or `BOTH`. HomeKit exposes a single on/off swing control; this picks which axis(es) it drives |
| | `ac_air_quality` | Air quality sensor, if supported |
| | `ac_temperature_sensor` / `ac_humidity_sensor` | Separate sensors for automations |
| | `ac_fan_control` / `ac_jet_control` | Extra controls, if supported |
| | `ac_led_control` | LED panel switch |
| | `ac_energy_save` / `ac_air_clean` | Energy Saver / Air Clean switches, where supported (default on) |
| | `ac_temperature_unit` | `C` or `F` |
| | `ac_buttons` | Extra mode buttons: `[{"name": "Dry", "op_mode": 1}]` |
| Refrigerator | `ref_express_freezer` | Express Freezer / Ice Plus switch |
| | `ref_express_fridge` | Express Fridge switch |
| | `ref_eco_friendly` | Eco Friendly switch |
| Air purifier | `air_fast_mode` | Fast mode switch |
| Oven / Range | `burners_name` | Name of the separate cooktop Burners accessory (default "Burners"). LG reports ranges as `OVEN`; the accessory is created for `OVEN` devices |

## Implementation Status

| Device | ThinQ2 | ThinQ1 | Control | Notes |
| --- | --- | --- | --- | --- |
| Refrigerator | ✔️ | ✔️ | ✔️ | |
| Air Purifier | ✔️ | ✔️ | ✔️ | |
| AeroTower | ✔️ | 🚫 | ✔️ | Extends the air purifier with temperature, humidity and UV-nano services |
| Washer & Dryer | ✔️ | ✔️ | ThinQ1 only | ThinQ2 is status-only |
| WashTower 2 (new kind) | ✔️ | 🚫 | 🚫 | Status only |
| Dishwasher | ✔️ | 🚫 | 🚫 | Status only |
| Dehumidifier | ✔️ | 🚫 | ✔️ | |
| AC | ✔️ | ✔️ | ✔️ | |
| Oven / Range | ✔️ | 🚫 | ✔️ | Cooktop published as a separate Burners accessory |
| Microwave | ✔️ | 🚫 | ✔️ | |
| Styler | ✔️ | 🚫 | 🚫 | Status only |
| Range Hood | ✔️ | ✔️ | ✔️ | |

`Control` means HomeKit can send commands; devices marked 🚫 still publish status.

For more device support, please open an issue request.

## Contributors ✨

- Special thanks to [carlosgamezvillegas](https://github.com/carlosgamezvillegas) for implementing Oven & Microwave device support. More detail in [#87](https://github.com/nVuln/homebridge-lg-thinq/issues/87).

## Support

Questions and bug reports: please [open an issue](https://github.com/rnikoopour/homebridge-lg-thinq/issues/new).

## CLI Usage

The package installs the `thinq` CLI (or install it globally with
`npm i -g @rnikoopour/homebridge-lg-thinq`).

```
$ thinq
Usage: thinq [options] [command]

Options:
  -c, --country <type>         Country code for account (default: "US")
  -l, --language <type>        Language code for account (default: "en-US")
  -h, --help                   display help for command

Commands:
  login <username> <password>  Obtain refresh_token from LG account
  auth                         Obtain refresh_token from an account logged by
                               Google, Apple, Facebook or Amazon
  help [command]               display help for command
```

`thinq login` prints the refresh token. `thinq auth` prints a login URL; open it,
sign in, then paste the redirected URL back into the terminal.
