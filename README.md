# Boiler Control Card

Responsive Lovelace card for **Boiler Bridge**. It can be placed in any Home Assistant dashboard; it is not a full-panel custom view.

## Installation with HACS
1. Open HACS → Frontend.
2. Add this repository as a custom repository with category **Dashboard**.
3. Install **Boiler Control Card**.
4. Reload the browser frontend if Home Assistant asks for it.

## Card configuration

```yaml
type: custom:boiler-control-card
title: Котёл
show_diagnostics: false
```

The card follows Home Assistant theme variables, adapts to desktop/mobile widths, and uses Boiler Bridge entities for confirmed `Пуск / Работа` and `Поддержка` state.
