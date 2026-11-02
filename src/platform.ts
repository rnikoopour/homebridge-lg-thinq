import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { Helper } from './helper';
import {ThinQ} from './lib/ThinQ';
import {EventEmitter} from 'events';
import {PlatformType} from './lib/constants';
import {ManualProcessNeeded, NotConnectedError} from './errors';
import {Device} from './lib/Device';
import Characteristics from './characteristics';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class LGThinQHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly customCharacteristics: ReturnType<typeof Characteristics> = Characteristics(this.api.hap.Characteristic);

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  public readonly ThinQ: ThinQ;
  public readonly events: EventEmitter;
  private readonly intervalTime;

  // enable thinq1 support
  private readonly enable_thinq1: boolean = false;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.events = new EventEmitter();

    this.enable_thinq1 = config.thinq1 as boolean;
    this.config.devices = this.config.devices || [];

    this.intervalTime = (config.refresh_interval || 5) * 1000;
    this.ThinQ = new ThinQ(this, config, log);

    if (!config.country || !config.language || !((config.username && config.password) || config.refresh_token)) {
      this.log.error('Missing required config parameter.');
      return;
    }

    const didFinishLaunching = () => {
      // run the method to discover / register your devices as accessories
      this.ThinQ.isReady().then(() => {
        this.log.info('Successfully connected to the ThinQ API.');
        const discoverDevices = () => {
          this.discoverDevices().then(async () => {
            await this.startMonitor();
          }).catch(err => {
            if (err instanceof NotConnectedError) {
              setTimeout(() => {
                discoverDevices();
              }, 30000);
            } else {
              this.log.error(err.message);
              this.log.debug(err);
            }
          });
        };

        discoverDevices();
      }).catch(err => {
        if (err.message === 'Internal Server Error' || err.code?.indexOf('ECONN') === 0 || err instanceof NotConnectedError) {
          this.log.error('LG ThinQ internal server error, try again later.');
        } else {
          this.log.error('ThinQ API is not ready. please check configuration and try again.');
        }

        this.log.error(err.message);
        this.log.debug(err);
      });
    };

    this.api.on('didFinishLaunching', async () => {
      this.log.debug('Executed didFinishLaunching callback');
      didFinishLaunching();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from Homebridge cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Dishwasher and Oven used to be published with a Television service, which the
   * Home app shows as "TV" regardless of the configured name. They now publish
   * without it under a separate, stable UUID so Home adds them fresh.
   */
  private accessoryUUID(device: Device): string {
    if (['DISHWASHER', 'OVEN'].includes(device.type)) {
      return this.api.hap.uuid.generate(device.id + ':no-tv');
    }

    return device.id;
  }

  /**
   * Link every published service to the accessory's primary service so the Home
   * app shows the appliance as one tile with its parts bundled inside.
   */
  private bundleServices(accessory: PlatformAccessory) {
    const primary = accessory.services.find(service => service.isPrimaryService);
    if (!primary) {
      return;
    }

    for (const service of accessory.services) {
      if (service === primary || service.UUID === this.api.hap.Service.AccessoryInformation.UUID) {
        continue;
      }
      if (!primary.linkedServices.includes(service)) {
        primary.addLinkedService(service);
      }
    }
  }

  /**
   * Prefix every secondary service's published Name with the appliance name, e.g.
   * "Program Finished" -> "Washer Program Finished", "Stop Oven" -> "Oven Stop".
   * Only the Name characteristic changes; service displayName/subtype (used to
   * find cached services) stay as they are.
   */
  private prefixServiceNames(accessory: PlatformAccessory, deviceName: string) {
    const { Service, Characteristic } = this.api.hap;
    const escaped = deviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const deviceWord = new RegExp('\\b' + escaped + '\\b', 'gi');

    for (const service of accessory.services) {
      if (service.isPrimaryService || service.UUID === Service.AccessoryInformation.UUID) {
        continue;
      }
      const current = String(service.getCharacteristic(Characteristic.Name).value ?? service.displayName ?? '');
      const base = current.replace(deviceWord, ' ').replace(/^[\s-]+|[\s-]+$/g, '').replace(/\s+/g, ' ');
      const name = base ? deviceName + ' ' + base : deviceName;
      if (name !== current) {
        service.setCharacteristic(Characteristic.Name, name);
      }
    }
  }

  async discoverDevices() {
    const accessoriesToRemoveUUID = this.accessories.map(accessory => accessory.UUID);

    const devices: Device[] = await this.ThinQ.devices();

    if (!devices.length) {
      if (this.accessories.length) {
        // An empty list while accessories are cached is almost always a transient
        // LG account state (e.g. a pending terms agreement), not every appliance
        // being removed. Removing them would make HomeKit delete every automation
        // that references them, so keep the cache and wait for the next start.
        this.log.warn('ThinQ returned no devices; keeping ' + this.accessories.length +
          ' cached accessories instead of removing them. Check the LG ThinQ app, then restart Homebridge.');
        return;
      }
      this.log.warn('No ThinQ devices in your account.');
    }

    for (const device of devices) {
      // The name from the Homebridge config wins over the LG app alias.
      const deviceConfig = this.config.devices.find(enabled => enabled.id === device.id);
      if (deviceConfig?.name) {
        device.data.alias = deviceConfig.name;
      }

      this.log.debug('Device ['+device.name+']: ', device.toString());
      this.log.debug(JSON.stringify(device.data));

      if (!this.enable_thinq1 && device.platform === PlatformType.ThinQ1) {
        this.log.debug('Thinq1 device is skipped: ', device.toString());
        continue;
      }

      if (this.config.devices.length && !this.config.devices.find(enabled => enabled.id === device.id)) {
        this.log.info('Device skipped: ', device.id);
        continue;
      }

      this.log.info('['+device.name+'] Setting up device!');
      const setupSuccess = await this.ThinQ.setup(device);

      if (!setupSuccess) {
        this.log.warn('['+device.name+'] Failed to setup device!');
        continue;
      }

      const accessoryType = Helper.make(device);
      if (accessoryType === null) {
        this.log.info('Device not supported: '+ device.platform + ': ' + device.toString());
        this.ThinQ.unregister(device).then(() => {
          this.log.debug(device.id, '- unregistered!');
        });
        continue;
      }

      let lgThinQDevice;

      const uuid = this.accessoryUUID(device);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
      if (existingAccessory) {
        accessoriesToRemoveUUID.splice(accessoriesToRemoveUUID.indexOf(uuid), 1);

        this.log.info('Restoring existing accessory:', device.toString());
        existingAccessory.context.device = device;
        // Names are published only through Name (like homebridge-pihole); drop any
        // writable ConfiguredName left in the cache by earlier versions.
        const configuredNameUUID = this.api.hap.Characteristic.ConfiguredName.UUID;
        for (const service of existingAccessory.services) {
          for (const characteristic of [...service.characteristics]) {
            if (characteristic.UUID === configuredNameUUID) {
              service.removeCharacteristic(characteristic);
            }
          }
        }
        if (existingAccessory.displayName !== device.name) {
          this.log.info('Updating accessory name:', existingAccessory.displayName, '->', device.name);
          existingAccessory.updateDisplayName(device.name);
          this.api.updatePlatformAccessories([existingAccessory]);
        }
        lgThinQDevice = new accessoryType(this, existingAccessory);
      } else {
        this.log.info('Adding new accessory:', device.toString());

        const category = Helper.category(device);
        // create a new accessory
        const accessory = new this.api.platformAccessory(device.name, uuid, category);
        accessory.context.device = device;

        lgThinQDevice = new accessoryType(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);

        this.accessories.push(accessory);
      }

      const deviceAccessory = this.accessories.find(accessory => accessory.UUID === uuid) as PlatformAccessory;
      if (['DISHWASHER', 'OVEN'].includes(device.type)) {
        this.bundleServices(deviceAccessory);
      }
      this.prefixServiceNames(deviceAccessory, device.name);

      this.events.on(device.id, lgThinQDevice.update.bind(lgThinQDevice));

      // first time update
      lgThinQDevice.updateAccessoryCharacteristic(device);
    }

    const accessoriesToRemove = this.accessories.filter(accessory => accessoriesToRemoveUUID.includes(accessory.UUID));
    if (accessoriesToRemove.length) {
      accessoriesToRemove.map(accessory => {
        this.log.info('Removing accessory:', accessory.displayName);
        this.accessories.splice(this.accessories.indexOf(accessory), 1);
      });

      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
    }
  }

  protected async startMonitor() {
    // thinq2 device
    const thinq2devices = this.accessories.filter(accessory => accessory.context.device.platform === PlatformType.ThinQ2);

    if (thinq2devices.length) {
      setInterval(() => {
        this.ThinQ.devices().then((devices) => {
          devices.filter(device => device.platform === PlatformType.ThinQ2).forEach(device => {
            this.events.emit(device.id, device.snapshot);
          });
        });
      }, this.intervalTime); // every interval minute - backup method if mqtt not working

      this.log.info('Start MQTT listener for thinq2 device');
      await this.ThinQ.registerMQTTListener((data) => {
        if ('data' in data && 'deviceId' in data) {
          this.events.emit(data.deviceId, data.data?.state?.reported);
        }
      });
    }

    if (this.accessories.length <= thinq2devices.length) {
      return; // no thinq1 device, stop here
    }

    // polling thinq1 device
    this.log.info('Start polling device data every '+ this.config.refresh_interval +' second.');
    const ThinQ = this.ThinQ;
    const interval = setInterval(async () => {
      try {
        for (const accessory of this.accessories) {
          const device: Device = accessory.context.device;
          if (device.platform === PlatformType.ThinQ1 && this.enable_thinq1) {
            const deviceWithSnapshot = await ThinQ.pollMonitor(device);
            if (deviceWithSnapshot.snapshot.raw !== null) {
              this.events.emit(device.id, deviceWithSnapshot.snapshot);
            }
          }
        }
      } catch (err) {
        if (err instanceof ManualProcessNeeded) {
          this.log.info('Stop polling device data.');
          this.log.warn(err.message);
          clearInterval(interval);
          return; // stop plugin here
        }
      }
    }, this.intervalTime);
  }
}
