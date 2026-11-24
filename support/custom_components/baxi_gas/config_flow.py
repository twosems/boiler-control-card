"""Select local Home Assistant telemetry sources."""

from homeassistant import config_entries
from homeassistant.helpers import entity_registry
from homeassistant.helpers.selector import EntitySelector, EntitySelectorConfig
import voluptuous as vol

from .const import DOMAIN, SOURCES


class BaxiGasConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure the one gas meter monitored by this integration."""

    @staticmethod
    def schema(defaults):
        fields = {}
        for source in SOURCES:
            key = (
                vol.Optional(source, default=defaults[source])
                if defaults.get(source) else vol.Optional(source)
            )
            domains = ["binary_sensor"] if source == "flame" else ["sensor", "input_number"]
            fields[key] = EntitySelector(EntitySelectorConfig(domain=domains))
        return vol.Schema(fields)

    def guesses(self):
        suffixes = {"power": "_heating_power", "flame": "_flame", "setpoint": "_ack", "modulation": "_modulation"}
        entities = entity_registry.async_get(self.hass).entities.values()
        guesses = {}
        for field, suffix in suffixes.items():
            matches = [
                item.entity_id for item in entities
                if item.platform == "mqtt" and item.unique_id.startswith("baxi_s2_") and item.unique_id.endswith(suffix)
            ]
            if len(matches) == 1:
                guesses[field] = matches[0]
        return guesses

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(title="Газ и котёл Baxi", data=user_input)
        return self.async_show_form(step_id="user", data_schema=self.schema(self.guesses()))

    async def async_step_reconfigure(self, user_input=None):
        entry = self._get_reconfigure_entry()
        if user_input is not None:
            return self.async_update_reload_and_abort(entry, data=user_input)
        return self.async_show_form(step_id="reconfigure", data_schema=self.schema(entry.data))
