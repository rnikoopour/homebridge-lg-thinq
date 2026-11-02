import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { Helper } from './helper';
import Range from './devices/Range';
import {ThinQ} from './lib/ThinQ';
import {EventEmitter} from 'events';
import {PlatformType} from './lib/constants';
import {AccessoryPlan, accessoryPlans, configuredName, deviceDecision, keepCacheOnEmptyDeviceList, prefixedServiceName} from './platformLogic';
import {ManualProcessNeeded, NotConnectedError} from './errors';
import {Device} from './lib/Device';
import Characteristics from './characteristics';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class LGThinQHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly customCharacteristics: ReturnType<typeof Characteristics>;

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
    // Assigned here, not as field initializers: class fields are initialized
    // before constructor parameter properties such as `api` are set.
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.customCharacteristics = Characteristics(api.hap.Characteristic);

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

  /** The UUID for an accessory plan: the device id, or one generated from the plan's seed. */
  private uuidFor(device: Device, plan: AccessoryPlan): string {
    return plan.uuidSeed === null ? device.id : this.api.hap.uuid.generate(plan.uuidSeed);
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
   * Prefix every secondary service's Name and ConfiguredName with the appliance
   * name, e.g. "Program Finished" -> "Washer Program Finished", "Stop Oven" ->
   * "Oven Stop". Service displayName/subtype (used to find cached services) stay
   * as they are.
   */
  private prefixServiceNames(accessory: PlatformAccessory, deviceName: string) {
    const { Service, Characteristic } = this.api.hap;

    for (const service of accessory.services) {
      if (service.isPrimaryService || service.UUID === Service.AccessoryInformation.UUID) {
        continue;
      }
      const current = String(service.getCharacteristic(Characteristic.Name).value ?? service.displayName ?? '');
      const name = prefixedServiceName(current, deviceName);
      if (name !== current) {
        service.setCharacteristic(Characteristic.Name, name);
      }
      // The Home app labels each part of a multi-service accessory by its
      // ConfiguredName; without it every part shows the accessory's name.
      service.addOptionalCharacteristic(Characteristic.ConfiguredName);
      service.setCharacteristic(Characteristic.ConfiguredName, name);
    }
  }

  /**
   * Restore a cached accessory (or add a new one) for a device, wire its handler to
   * device updates and push the first state. Several accessories may share a device.
   */
  private restoreOrAddAccessory(device: Device, uuid: string, name: string, accessoryType,
    accessoriesToRemoveUUID: string[], bundle: boolean) {
    let accessory = this.accessories.find(cached => cached.UUID === uuid);
    if (accessory) {
      accessoriesToRemoveUUID.splice(accessoriesToRemoveUUID.indexOf(uuid), 1);
      this.log.info('Restoring existing accessory:', name, '(' + device.toString() + ')');
      accessory.context.device = device;
      if (accessory.displayName !== name) {
        this.log.info('Updating accessory name:', accessory.displayName, '->', name);
        accessory.updateDisplayName(name);
        this.api.updatePlatformAccessories([accessory]);
      }
    } else {
      this.log.info('Adding new accessory:', name, '(' + device.toString() + ')');
      accessory = new this.api.platformAccessory(name, uuid, Helper.category(device));
      accessory.context.device = device;
    }

    const handler = new accessoryType(this, accessory);
    if (!this.accessories.includes(accessory)) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }

    if (bundle) {
      this.bundleServices(accessory);
    }
    this.prefixServiceNames(accessory, name);
    this.events.on(device.id, handler.update.bind(handler));
    handler.updateAccessoryCharacteristic(device);
    return handler;
  }

  async discoverDevices() {
    const accessoriesToRemoveUUID = this.accessories.map(accessory => accessory.UUID);

    const devices: Device[] = await this.ThinQ.devices();

    if (keepCacheOnEmptyDeviceList(devices.length, this.accessories.length)) {
      // See keepCacheOnEmptyDeviceList: removing them would delete HomeKit automations.
      this.log.warn('ThinQ returned no devices; keeping ' + this.accessories.length +
          ' cached accessories instead of removing them. Check the LG ThinQ app, then restart Homebridge.');
      return;
    }
    if (!devices.length) {
      this.log.warn('No ThinQ devices in your account.');
    }

    for (const device of devices) {
      const name = configuredName(device.id, this.config.devices);
      if (name) {
        device.data.alias = name;
      }

      this.log.debug('Device ['+device.name+']: ', device.toString());
      this.log.debug(JSON.stringify(device.data));

      const decision = deviceDecision(device, this.config.devices, this.enable_thinq1);
      if (decision === 'skip-thinq1') {
        this.log.debug('Thinq1 device is skipped: ', device.toString());
        continue;
      }
      if (decision === 'skip-not-selected') {
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

      for (const plan of accessoryPlans(device, device.name, this.config.devices)) {
        this.restoreOrAddAccessory(device, this.uuidFor(device, plan), plan.name,
          plan.kind === 'burners' ? Range : accessoryType, accessoriesToRemoveUUID, plan.bundle);
      }
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
