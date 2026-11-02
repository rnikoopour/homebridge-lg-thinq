
<p align="center">
<img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>


# Homebridge LG ThinQ

> **Maintained fork** by [rnikoopour](https://github.com/rnikoopour) of [nVuln/homebridge-lg-thinq](https://github.com/nVuln/homebridge-lg-thinq) (Apache-2.0), based on upstream v1.8.11. See [CHANGELOG.md](CHANGELOG.md) for what changed. Published to npm as [`@rnikoopour/homebridge-lg-thinq`](https://www.npmjs.com/package/@rnikoopour/homebridge-lg-thinq).

## Overview

A Homebridge plugin for controlling/monitoring LG ThinQ device via their ThinQ platform.

⚠️ This library works with v2 of the LG ThinQ API. But some v1 device may backward compatible, please check table [Implementation Status](#implementation-status) below.

A plugin for interacting with the "LG ThinQ" system, which can control new LG smart device. API used in this plugin is not official, I reversed from their "LG ThinQ" mobile app.

## Installation

Search for `@rnikoopour/homebridge-lg-thinq` in the Homebridge UI, or:

```
npm i -g @rnikoopour/homebridge-lg-thinq
```

### LG terms of service

When LG publishes new terms for your account, the plugin accepts them automatically
so the integration keeps working (it logs "Handling new term agreement..." when it
does). If LG still returns no devices afterwards, cached accessories are kept rather
than removed; open the LG ThinQ app and restart Homebridge.

### Migrating from `homebridge-lg-thinq`

The package name changed, so Homebridge would treat existing accessories as new
(and HomeKit would drop their rooms and automations). To keep them, stop
Homebridge, uninstall `homebridge-lg-thinq`, install this package, and relabel the
cached accessories before starting Homebridge again:

```
cd <homebridge storage path>/accessories
# cachedAccessories (main bridge) or cachedAccessories.<child bridge id>
jq '(.[] | select(.plugin == "homebridge-lg-thinq") | .plugin) = "@rnikoopour/homebridge-lg-thinq"' \
  cachedAccessories.XXXX > tmp && mv tmp cachedAccessories.XXXX
```

The `LGThinQ` platform config is unchanged.

# Configuration

> ✔️ I highly recommend using [homebridge-config-ui-x](https://github.com/homebridge/homebridge-config-ui-x#readme) to make these changes.

1. Navigate to the Plugins page in [homebridge-config-ui-x](https://github.com/homebridge/homebridge-config-ui-x).
2. Click the **Settings** button for the LG ThinQ plugin.
3. Login to your LG account
4. Add or remove which devices you want
5. Restart Homebridge for the changes to take effect.

> ⚠️ Or you can manual edit it, add json below to config.json (not recommend)
```json
{
  "auth_mode": "token",
  "refresh_token": "**refresh*token**",
  "username": "lg username",
  "password": "lg password",
  "country": "US",
  "language": "en-US",
  "thinq1": false,
  "devices": [
	{
	  "id": "device id"
	}
  ],
  "platform": "LGThinQ"
}

```
- `auth_mode` Required. You can choose between `token` and `account`
- `refresh_token` Required if `auth_mode` = `token`. The `refresh_token` of your account.
- `username` Required if `auth_mode` = `account`. LG thinQ account
- `password` Required if `auth_mode` = `account`. LG thinQ password
- `country` Required. Your account [country alpha-2 code](https://www.countrycode.org/), e.g., US for the USA.
- `language` Required. Your account language code, e.g., en-US, vi-VN.
- `devices` List devices you want add to homebridge, leave it empty if you want add all devices. See [Device configuration](#device-configuration).
- `thinq1` Optional. Enable thinq1 device support
- `refresh_interval` Optional. Seconds between status polls (default 60): ThinQ1 devices rely on this polling, ThinQ2 devices use it as a backup in case real-time (MQTT) updates are missed. Keep it above 30 with ThinQ1 devices, or LG may block the account.
- `platform` value always `LGThinQ`

## Plugin Authorization Setting

The plugin signs in with an LG account username and password.

If your LG account uses Google, Apple or Facebook sign-in, create a second LG
account with a username and password (it can use the same email; LG treats them
as separate accounts), share your home with it from the LG ThinQ app, and use the
second account in the plugin settings.

To avoid storing a password, use `auth_mode: "token"` with a `refresh_token`
obtained from the bundled CLI (see [CLI Usage](#cli-usage)):

```
$ thinq login <username> <password> -c US -l en-US
Your refresh_token: ...
```

## Device configuration

Each entry in `devices` takes `id` (required) and `name` (optional, overrides the
LG app name). Device-specific options, all off unless noted:

| Device | Option | Description |
| --- | --- | --- |
| Washer / Dryer / WashTower | `washer_trigger` | "Program Finished" occupancy sensor for automations |
| | `washer_door_lock` | Door lock status |
| | `washer_tub_clean` | Tub clean event |
| Dishwasher | `dishwasher_trigger` | "Program Finished" occupancy sensor |
| Air conditioner | `ac_mode` | `COOLING`, `HEATING` or `BOTH` (default) |
| | `ac_swing_mode` | `VERTICAL`, `HORIZONTAL` or `BOTH` (on/off only) |
| | `ac_air_quality` | Air quality sensor, if supported |
| | `ac_temperature_sensor` / `ac_humidity_sensor` | Separate sensors for automations |
| | `ac_led_control` / `ac_fan_control` / `ac_jet_control` | Extra controls, if supported |
| | `ac_energy_save` / `ac_air_clean` | Switches (default on) |
| | `ac_temperature_unit` | `C` or `F` |
| | `ac_buttons` | Extra mode buttons: `[{"name": "Dry", "op_mode": 1}]` |
| Refrigerator | `ref_express_freezer` / `ref_express_fridge` / `ref_eco_friendly` | Switches |
| Air purifier | `air_fast_mode` | Fast mode switch |
| Range | `burners_name` | Name of the separate cooktop Burners accessory (default "Burners") |

## Implementation Status

| *Device*       | *Implementation* | *Status* | *Control* | *Thinq2* | *Thinq1* |
|----------------| --- | --- | --- | --- | --- |
| Refrigerator   | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ |
| Air Purifier   | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ |
| Washer & Dryer | ✔️ | ✔️ | 🚫 | ✔️ | ✔️ |
| Dishwasher     | ✔️ | ✔️ | 🚫 | ✔️ | 🚫 |
| Dehumidifier   | ✔️ | ✔️ | ⚠️ | ✔️ | 🚫 |
| AC             | ✔️ | ✔️ | ✔️ | ✔️ | ✔️ |
| Oven           | ✔️ | ✔️ | ✔️ | ⚠️ | ⚠️ |
| Microwave      | ✔️ | ✔️ | ✔️ | ⚠️ | ⚠️ |

for more device support please open issue request.

## Contributors ✨

- Special thank to [carlosgamezvillegas](https://github.com/carlosgamezvillegas) for implementing Oven & Microwave device support. More detail in [#87](https://github.com/nVuln/homebridge-lg-thinq/issues/87)

## Support

If you have a question, please [open an issue](https://github.com/rnikoopour/homebridge-lg-thinq/issues/new).  
If you would like to report a bug, please [open an issue](https://github.com/rnikoopour/homebridge-lg-thinq/issues/new).

## CLI Usage

```
$ thinq
Usage: thinq [options] [command]

Options:
  -c, --country <type>         Country code for account (default: "US")
  -l, --language <type>        Language code for account (default: "en-US")
  -h, --help                   display help for command

Commands:
  login <username> <password>  Obtain refresh_token from LG account
  auth                         Obtain refresh_token from account logged by Google Account, Apple ID
  help [command]               display help for command
```
