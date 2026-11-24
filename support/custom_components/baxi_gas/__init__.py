"""Capture boiler telemetry and expose the gas ledger to Lovelace."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import timedelta
import logging
import math

from homeassistant.components import websocket_api
from homeassistant.const import EVENT_HOMEASSISTANT_STOP, Platform
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
import voluptuous as vol

from .const import DOMAIN, SIGNAL_UPDATED, SOURCES
from .ledger import GasLedger, SAMPLE_SECONDS

_LOGGER = logging.getLogger(__name__)
POWER_MAX_AGE = 25
CONTEXT_MAX_AGE = 6 * 3600
FAST_CONTEXT = ("modulation", "power")
TEMPERATURES = ("outdoor", "indoor", "setpoint")


class GasRuntime:
    """Sampling and persistence on the Home Assistant side."""

    def __init__(self, hass, sources, storage, ledger):
        self.hass = hass
        self.sources = sources
        self.storage = storage
        self.ledger = ledger
        self.lock = asyncio.Lock()
        self.live = {}

    def _fresh_state(self, field, now, max_age):
        if not (entity_id := self.sources.get(field)):
            return None
        state = self.hass.states.get(entity_id)
        if state is None or state.state in ("unknown", "unavailable"):
            return None
        updated = getattr(state, "last_reported", state.last_updated)
        if (now - updated).total_seconds() > max_age:
            return None
        return state

    def _value(self, field, now):
        max_age = POWER_MAX_AGE if field in FAST_CONTEXT else CONTEXT_MAX_AGE
        state = self._fresh_state(field, now, max_age)
        if state is None:
            return None
        try:
            value = float(state.state)
        except ValueError:
            return None
        if not math.isfinite(value):
            return None
        unit = state.attributes.get("unit_of_measurement")
        if field == "power":
            if unit == "W":
                value /= 1000
            elif unit != "kW":
                return None
            return value if 0 <= value <= 1000 else None
        if field in TEMPERATURES:
            if unit == "°F":
                return (value - 32) * 5 / 9
            if unit == "K":
                return value - 273.15
        return value

    @callback
    def sample(self, now):
        values = {field: self._value(field, now) for field in SOURCES if field != "flame"}
        self.ledger.sample(now.timestamp(), values)
        flame = self._fresh_state("flame", now, POWER_MAX_AGE)
        self.live = {**values, "flame": flame.state if flame and flame.state in ("on", "off") else None}

    @callback
    def tick(self, now):
        if not self.lock.locked():
            self.sample(now)

    async def _save(self):
        self.ledger.prune(dt_util.utcnow().timestamp())
        await self.storage.async_save(deepcopy(self.ledger.data))

    async def save(self, _now=None):
        async with self.lock:
            await self._save()

    async def publish(self, _now=None):
        async_dispatcher_send(self.hass, SIGNAL_UPDATED)

    async def add_reading(self, value, other_gas):
        async with self.lock:
            now = dt_util.utcnow()
            self.sample(now)
            readings = self.ledger.data["readings"]
            self.ledger.add_reading(now.timestamp(), value, other_gas)
            try:
                await self._save()
            except Exception:
                readings.pop()
                raise
        await self.publish()

    async def set_tariff(self, value):
        async with self.lock:
            now = dt_util.utcnow()
            self.sample(now)
            tariffs = self.ledger.data["tariffs"]
            size = len(tariffs)
            self.ledger.set_tariff(now.timestamp(), value)
            try:
                await self._save()
            except Exception:
                del tariffs[size:]
                raise
        await self.publish()

    def snapshot(self):
        return {**self.ledger.snapshot(dt_util.now()), "live": self.live, "has_power_source": bool(self.sources.get("power"))}


async def async_setup(hass, _config):
    """Register local frontend commands."""
    for command in (ws_summary, ws_reading, ws_tariff):
        websocket_api.async_register_command(hass, command)
    return True


async def async_setup_entry(hass, entry):
    storage = Store(hass, 1, f"{DOMAIN}.{entry.entry_id}")
    runtime = GasRuntime(hass, entry.data, storage, GasLedger(await storage.async_load()))
    entry.runtime_data = runtime
    hass.data[DOMAIN] = runtime
    runtime.sample(dt_util.utcnow())
    entry.async_on_unload(async_track_time_interval(hass, runtime.tick, timedelta(seconds=SAMPLE_SECONDS)))
    entry.async_on_unload(async_track_time_interval(hass, runtime.publish, timedelta(minutes=1)))
    entry.async_on_unload(async_track_time_interval(hass, runtime.save, timedelta(minutes=5)))

    async def stop(_event):
        await runtime.save()

    entry.async_on_unload(hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop))
    await hass.config_entries.async_forward_entry_setups(entry, [Platform.SENSOR])
    return True


async def async_unload_entry(hass, entry):
    if not await hass.config_entries.async_unload_platforms(entry, [Platform.SENSOR]):
        return False
    await entry.runtime_data.save()
    hass.data.pop(DOMAIN, None)
    return True


def _runtime(hass, connection, msg, *, edit=False):
    if edit and (connection.user is None or not connection.user.is_admin):
        connection.send_error(msg["id"], "unauthorized", "Требуется доступ администратора")
        return None
    runtime = hass.data.get(DOMAIN)
    if runtime is None:
        connection.send_error(msg["id"], "not_loaded", "Интеграция «Газ и котёл Baxi» не настроена")
    return runtime


@websocket_api.websocket_command({vol.Required("type"): "baxi_gas/summary"})
@callback
def ws_summary(hass, connection, msg):
    if runtime := _runtime(hass, connection, msg):
        connection.send_result(msg["id"], runtime.snapshot())


@websocket_api.websocket_command({
    vol.Required("type"): "baxi_gas/add_reading",
    vol.Required("value"): vol.Coerce(float),
    vol.Optional("other_gas", default=False): bool,
})
@websocket_api.async_response
async def ws_reading(hass, connection, msg):
    if not (runtime := _runtime(hass, connection, msg, edit=True)):
        return
    try:
        await runtime.add_reading(msg["value"], msg["other_gas"])
    except ValueError as err:
        connection.send_error(msg["id"], str(err), str(err))
    except Exception:
        _LOGGER.exception("Could not save gas meter reading")
        connection.send_error(msg["id"], "storage_error", "Не удалось сохранить показание")
    else:
        connection.send_result(msg["id"], runtime.snapshot())


@websocket_api.websocket_command({
    vol.Required("type"): "baxi_gas/set_tariff",
    vol.Required("rub_m3"): vol.Coerce(float),
})
@websocket_api.async_response
async def ws_tariff(hass, connection, msg):
    if not (runtime := _runtime(hass, connection, msg, edit=True)):
        return
    try:
        await runtime.set_tariff(msg["rub_m3"])
    except ValueError as err:
        connection.send_error(msg["id"], str(err), str(err))
    except Exception:
        _LOGGER.exception("Could not save gas tariff")
        connection.send_error(msg["id"], "storage_error", "Не удалось сохранить тариф")
    else:
        connection.send_result(msg["id"], runtime.snapshot())
