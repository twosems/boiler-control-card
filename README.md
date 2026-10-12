# Boiler Control Card

Responsive Lovelace card for the ESP32 boiler controller.

The card now supports two data sources automatically:

- **MQTT Discovery** — recommended for the portable installation. If the ESP32 is connected to Home Assistant through Mosquitto, the card finds the boiler entities by the stable firmware tokens (`PAGE`, `BTEMP`, `P1START`, etc.). No `entity_id` list is required.
- **Boiler Bridge** — kept for existing installations. When a compatible Boiler Bridge entity is present, the card uses its entity map automatically.

## Installation with HACS

1. Open HACS → Frontend.
2. Add `https://github.com/twosems/boiler-control-card` as a custom repository with category **Dashboard**.
3. Install **Boiler Control Card**.
4. Reload the Home Assistant frontend if requested.

## Card configuration

```yaml
type: custom:boiler-control-card
title: Котёл
view: compact
show_diagnostics: false
```

`view: compact` shows the dashboard widget with temperatures and primary controls. `view: full` opens the full boiler control panel.

For a single MQTT boiler no entity IDs need to be configured manually. The card follows Home Assistant theme variables and adapts to desktop/mobile widths.

## Development continuity

Read [AGENTS.md](AGENTS.md) and [context](docs/CONTEXT.md). The canonical firmware/version/recovery record is in [ha-boiler-bridge](https://github.com/twosems/ha-boiler-bridge/blob/main/docs/RECOVERY.md). Archived DE mirrors in `snapshots/` are historical evidence; this archive does not replace the HACS root card or deploy to Home Assistant.
