# Продолжение разработки карточек котла

Основной журнал, firmware и инструкции восстановления: [ha-boiler-bridge/docs/RECOVERY.md](https://github.com/twosems/ha-boiler-bridge/blob/main/docs/RECOVERY.md).
Срез 12.10.2026. Корневой HACS JS сохранён; архивирование не является обновлением frontend HA.
Исторические ресурсы: v8-v26 и portable15; позже overview history1 подтверждён пользователем. Текущий live cache ресурс надо читать с HA заново.
DE-мирrors full/v8 сохранены в snapshots с происхождением. Полный актуальный overview runtime source в этом переносе не найден, не выдавать существующий root card за exact current overview.
Следующая главная задача общей ветки — устойчивый UART-мост, без перепайки и без самостоятельной OTA; .3 passive не обеспечивает прежнее remote control.
