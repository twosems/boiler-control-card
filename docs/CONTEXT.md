# Продолжение разработки карточек котла

Основной журнал, firmware и инструкции восстановления: [ha-boiler-bridge/docs/RECOVERY.md](https://github.com/twosems/ha-boiler-bridge/blob/main/docs/RECOVERY.md).
Срез 12.10.2026. Корневой HACS JS сохранён; архивирование не является обновлением frontend HA.
Исторические ресурсы: v8-v26 и portable15; позже overview history1 подтверждён пользователем. Текущий live cache ресурс надо читать с HA заново.
DE-мирrors full/v8 сохранены в snapshots с происхождением. Полный актуальный overview runtime source в этом переносе не найден, не выдавать существующий root card за exact current overview.
Следующая главная задача общей ветки — устойчивый UART-мост, без перепайки и без самостоятельной OTA; .3 passive не обеспечивает прежнее remote control.

## 14.10.2026 — Shnek Control Card

Пользователь утвердил компактный дизайн отдельной карточки шнека: статус, последний запуск, периоды 3/6/12/24 ч, время работы, число включений, средний цикл, расчётный расход угля, компактная лента включений, последний/текущий цикл, раскрываемые последние 5 циклов и коэффициент подачи.

Реализован `custom:shnek-control-card` в этом HACS Dashboard repository. Merge PR #1: `e57299410acb814e8268722ca14213e753edcf2e`.

HACS теперь регистрирует `boiler-control-card-loader.js`; loader импортирует неизменённый `boiler-control-card.js` и новый `shnek-control-card.js`. Это позволяет одной HACS-установкой доставлять обе карточки. Сам код управления котлом в PR #1 не менялся.

Текущая офисная конфигурация для карточки:
- auger state: `binary_sensor.shnek_kotla`;
- power: `sensor.tz3000_qeuvnohg_ts011f_moshchnost`;
- feed coefficient helper: `input_number.shnek_feed_rate_kg_min`;
- last start: `input_datetime.shnek_last_start`;
- last cycle seconds: `input_number.shnek_last_cycle_sec`;
- рабочая оценка подачи: `3.0 кг/мин`, до физической калибровки.

Периодные показатели карточка получает из recorder history самой `binary_sensor.shnek_kotla`; переключение 3/6/12/24 ч не требует отдельных history_stats sensors.

На момент этой контрольной точки Git/HACS package готов, но live deployment новой карточки на офисный HA **не подтверждён**. Действующий офисный ресурс перед работой: `/local/boiler-control-card/boiler-control-card.js?v=20261008-1`, фактический SHA-256 `e72437f05cf21040faad1c398601a10f0d6e96df0027857b118e837f27d85748`. Старый большой shnek widget ещё состоит из стандартных Lovelace cards. Удалённый канал к HA через отдельный SSH key в момент deployment блокировался защитой инструмента; не считать новую карточку установленной, пока это не проверено на live HA.
