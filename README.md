# Boiler Control Card

Responsive Lovelace cards for the ESP32 boiler controller and boiler auger monitoring.

This HACS Dashboard repository contains two cards:

- `custom:boiler-control-card` — boiler telemetry and controls.
- `custom:shnek-control-card` — compact auger activity, runtime and estimated coal consumption.

HACS downloads all JavaScript files from the repository root, so both cards are distributed by the same Dashboard repository.

## Installation with HACS

1. Open HACS → Frontend / Dashboard.
2. Add `https://github.com/twosems/boiler-control-card` as a custom repository with category **Dashboard**.
3. Install **Boiler Control Card**.
4. Reload the Home Assistant frontend if requested.

## Boiler Control Card

The boiler card supports two data sources automatically:

- **MQTT Discovery** — recommended for the portable installation. If the ESP32 is connected to Home Assistant through Mosquitto, the card finds the boiler entities by the stable firmware tokens (`PAGE`, `BTEMP`, `P1START`, etc.). No `entity_id` list is required.
- **Boiler Bridge** — kept for existing installations. When a compatible Boiler Bridge entity is present, the card uses its entity map automatically.

```yaml
type: custom:boiler-control-card
title: Котёл
view: compact
show_diagnostics: false
```

`view: compact` shows the dashboard widget with temperatures and primary controls. `view: full` opens the full boiler control panel.

## Shnek Control Card

The auger card is a compact interactive view with:

- live auger state and current power;
- selectable periods: **3 / 6 / 12 / 24 hours**;
- runtime, activation count, average completed-cycle duration and estimated coal consumption for the selected period;
- a compact activation timeline;
- last/current cycle duration and estimated coal amount;
- expandable list of the last five completed cycles;
- adjustable auger feed coefficient in kg/min.

The period statistics are calculated directly from Home Assistant recorder history for the configured binary sensor. The card does not control the boiler or auger. Changing the feed coefficient changes only the consumption estimate.

Office example:

```yaml
type: custom:shnek-control-card
title: Шнек котла
entity: binary_sensor.shnek_kotla
power_entity: sensor.tz3000_qeuvnohg_ts011f_moshchnost
feed_rate_entity: input_number.shnek_feed_rate_kg_min
last_start_entity: input_datetime.shnek_last_start
last_cycle_sec_entity: input_number.shnek_last_cycle_sec
default_period: 12
feed_rate: 3.0
```

Only `entity` is essential for history-based statistics. The power sensor, calibration helper and last-cycle helpers are optional; the card degrades gracefully when optional entities are absent. `feed_rate` is used as a fallback when `feed_rate_entity` is unavailable.

The current `3.0 kg/min` value used in the office configuration is an engineering estimate and should be calibrated when measured auger output is available.

### Using the card on another Home Assistant

Installing the card through HACS only installs the frontend. The target Home Assistant must also have access to the auger state/history entities. If the auger exists on another Home Assistant, mirror or otherwise expose those entities first, then point the card configuration at the local mirrored entity IDs.

Both cards follow Home Assistant theme variables and adapt to desktop/mobile widths.

## Development continuity

Read [AGENTS.md](AGENTS.md) and [context](docs/CONTEXT.md). The canonical firmware/version/recovery record is in [ha-boiler-bridge](https://github.com/twosems/ha-boiler-bridge/blob/main/docs/RECOVERY.md). Archived DE mirrors in `snapshots/` are historical evidence; this archive does not replace the HACS root card or deploy to Home Assistant.
