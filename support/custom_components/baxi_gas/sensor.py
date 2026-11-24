"""Export measured gas and accumulated estimates as Home Assistant sensors."""

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import UnitOfVolume
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import SIGNAL_UPDATED


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities(
        GasSensor(entry, key, name)
        for key, name in (
            ("meter", "Газ Baxi по счётчику"),
            ("m3", "Газ Baxi расчётный накопительный"),
            ("rub", "Стоимость газа Baxi накопительная"),
        )
    )


class GasSensor(SensorEntity):
    _attr_should_poll = False
    _attr_state_class = SensorStateClass.TOTAL_INCREASING

    def __init__(self, entry, key, name):
        self._runtime = entry.runtime_data
        self._key = key
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_name = name
        if key == "rub":
            self._attr_device_class = SensorDeviceClass.MONETARY
            self._attr_state_class = SensorStateClass.TOTAL
            self._attr_native_unit_of_measurement = "RUB"
        else:
            self._attr_device_class = SensorDeviceClass.GAS
            self._attr_native_unit_of_measurement = UnitOfVolume.CUBIC_METERS

    @property
    def native_value(self):
        data = self._runtime.ledger.data
        if self._key == "meter":
            return data["readings"][-1]["value"] if data["readings"] else None
        if self._key == "rub" and self._runtime.ledger.tariff is None:
            return None
        if not any(row["estimate_seconds"] for row in data["buckets"].values()) and not data["totals"]["m3"]:
            return None
        return round(data["totals"][self._key], 3)

    async def async_added_to_hass(self):
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATED, self._updated))

    @callback
    def _updated(self):
        self.async_write_ha_state()
