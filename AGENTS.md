# Ветка котельных карточек

Читать [канонический контекст](https://github.com/twosems/ha-boiler-bridge/blob/main/docs/CONTEXT.md), [правила котельной ветки](https://github.com/twosems/ha-boiler-bridge/blob/main/AGENTS.md) и [восстановление](https://github.com/twosems/ha-boiler-bridge/blob/main/docs/RECOVERY.md) перед работой.
Не менять firmware/UART или общие HA-дашборды по задаче на отдельный элемент карточки.
Сохранить согласованный дизайн. Активное подтверждённое состояние зелёное, выключенное нейтральное; не считать отправленную команду фактическим состоянием.
Индивидуальные шаги регуляторов, optimistic series, подтверждение 15 секунд; status availability не выводить из неизменного PAGE/сохранённой уставки.
Page6 подписи над кнопками; page36 OK/DEL; настоящие P11/P12/P20 states; температуры по клику в History.
Перед изменением определить, какой JS/resource/version сейчас действительно загружен. JS cache revision, firmware version и integration version — разные значения.
`snapshots/de-mirror-20261012` — архив зеркал с DE, не готовая HACS-замена. Корневой JS не менять только ради архивирования.
Изменения, проверки, Git SHA и next step фиксировать в общей контрольной точке. Не тестировать реальную подачу/реверс/вентилятор без прямой команды.
