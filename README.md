
<p align="center">
<img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>


# Homebridge LG ThinQ

> **Maintained fork** by [rnikoopour](https://github.com/rnikoopour) of [nVuln/homebridge-lg-thinq](https://github.com/nVuln/homebridge-lg-thinq) (Apache-2.0), based on upstream v1.8.11. See [CHANGELOG.md](CHANGELOG.md) for what changed. Install from this repo's [releases](https://github.com/rnikoopour/homebridge-lg-thinq/releases), not npm.

## Overview

A Homebridge plugin for controlling/monitoring LG ThinQ device via their ThinQ platform.

⚠️ This library works with v2 of the LG ThinQ API. But some v1 device may backward compatible, please check table [Implementation Status](#implementation-status) below.

A plugin for interacting with the "LG ThinQ" system, which can control new LG smart device. API used in this plugin is not official, I reversed from their "LG ThinQ" mobile app.

## Installation

```
npm i -g homebridge-lg-thinq
```

# Configuration

> ✔️ I highly recommend using [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x#readme) to make these changes.

1. Navigate to the Plugins page in [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x).
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
- `devices` List devices you want add to homebridge, leave it empty if you want add all devices. See [Wiki](https://github.com/nVuln/homebridge-lg-thinq/wiki/Wiki) for specific device configuration.
- `thinq1` Optional. Enable thinq1 device support
- `platform` value always `LGThinQ`

## Plugin Authorization Setting

* See [Wiki - Plugin Authorization Setting](https://github.com/nVuln/homebridge-lg-thinq/wiki/Plugin-Authorization-Setting)

## Device specific configuration

* See [Wiki - Device Configuration](https://github.com/nVuln/homebridge-lg-thinq/wiki/Device-Configuration)

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
