const CARD_TYPE = 'baxi-gas-card';
const CARD_VERSION = '0.1.0';
const PERIODS = {day: 'Сегодня', week: 'Неделя', month: 'Месяц', rolling30: '30 суток'};
const ERRORS = {
  invalid_reading: 'Введите полное показание счётчика в м³.',
  reading_decreased: 'Новое показание должно быть не меньше предыдущего.',
  invalid_tariff: 'Введите цену за м³ в рублях.',
  unauthorized: 'Для записи нужен доступ администратора.',
  not_loaded: 'Настройте интеграцию «Газ и котёл Baxi».',
  unknown_command: 'Установите и настройте интеграцию «Газ и котёл Baxi».',
  storage_error: 'Home Assistant не смог сохранить запись. Повторите попытку.',
};

function number(value, unit = '', digits = 1) {
  if (!Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formNumber(value, upper) {
  const text = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  const result = Number(text);
  return result <= upper ? result : null;
}

class BaxiGasCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.period = 'day';
    this.sequence = 0;
    this.busy = false;
  }

  static getStubConfig() {
    return { type: `custom:${CARD_TYPE}`, title: 'Газ и котёл' };
  }

  setConfig(config) {
    this.config = { ...BaxiGasCard.getStubConfig(), ...config };
    if (!this.shadowRoot.children.length) this.build();
    this.show('title', this.config.title);
  }

  set hass(hass) {
    this.currentHass = hass;
    this.controls();
    if (this.isConnected && !this.requested) this.refresh();
  }

  connectedCallback() {
    this.refresh();
    if (!this.timer) this.timer = setInterval(() => this.refresh(), 30000);
  }

  disconnectedCallback() {
    clearInterval(this.timer);
    this.timer = null;
    this.requested = false;
    this.sequence++;
  }

  getCardSize() {
    return 7;
  }

  node(id) {
    return this.shadowRoot.getElementById(id);
  }

  show(id, text) {
    const node = this.node(id);
    if (node && node.textContent !== text) node.textContent = text;
  }

  controls() {
    const disabled = this.busy || !this.snapshot || this.currentHass?.user?.is_admin !== true;
    for (const id of ['saveMeter', 'saveRate', 'meter', 'rate', 'otherGas']) {
      const field = this.node(id);
      if (field) field.disabled = disabled;
    }
  }

  build() {
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;color:var(--primary-text-color)}
        *{box-sizing:border-box} [hidden]{display:none!important}
        ha-card{overflow:hidden}
        .body{padding:18px}
        header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}
        h2{font-size:20px;margin:0} h3{font-size:14px;margin:0 0 4px;font-weight:650}
        p{margin:0}small,.muted{color:var(--secondary-text-color);font-size:12px;line-height:1.45}
        .state{font-size:13px;white-space:nowrap;color:var(--secondary-text-color)}
        .state[data-on="true"]{color:var(--success-color,#22834b);font-weight:650}
        .live,.values{display:grid;gap:8px;grid-template-columns:repeat(4,minmax(0,1fr))}
        .values{grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:9px}
        .metric{padding:9px;min-width:0;border:1px solid var(--divider-color,#d4dce3);border-radius:10px}
        .metric strong{display:block;font-size:17px;font-variant-numeric:tabular-nums}
        .values .metric{padding:12px}.values strong{font-size:23px}
        .periods{display:flex;flex-wrap:wrap;gap:5px;margin:14px 0 9px}
        button,input{font:inherit;border-radius:8px;min-height:38px;padding:7px 10px}
        button{cursor:pointer;border:1px solid var(--divider-color,#d4dce3);background:transparent;color:inherit}
        button[aria-pressed="true"]{border-color:var(--primary-color);color:var(--primary-color);font-weight:650}
        button.primary{background:var(--primary-color,#006b91);color:var(--text-primary-color,#fff);border-color:transparent}
        button:disabled{opacity:.5;cursor:default}
        :is(button,input,summary):focus-visible{outline:2px solid var(--primary-color,#006b91);outline-offset:2px}
        .report{display:grid;gap:4px;margin:7px 0 12px}
        details{border-top:1px solid var(--divider-color,#d4dce3);padding:11px 0 4px}
        summary{font-weight:650;cursor:pointer}
        form{margin:10px 0 0}
        label{font-size:13px;font-weight:550}.entry{display:flex;gap:8px;align-items:end;flex-wrap:wrap}
        .entry label{display:grid;flex:1;gap:4px;min-width:min(140px,100%)}
        input{min-width:0;background:var(--card-background-color,#fff);color:inherit;border:1px solid var(--divider-color,#d4dce3)}
        .checkbox{display:flex;align-items:center;gap:7px;margin:6px 0;font-weight:400}
        .checkbox input{min-height:auto}
        .feedback{color:var(--error-color,#a22525);margin:6px 0;font-size:13px}
        .feedback[data-ok="true"]{color:var(--success-color,#22834b)}
        table{width:100%;border-collapse:collapse;text-align:left;font-size:12px;margin:8px 0}
        td,th{padding:5px 4px;border-bottom:1px solid var(--divider-color,#d4dce3);font-variant-numeric:tabular-nums}
        @media(max-width:500px){.body{padding:13px}.live{grid-template-columns:repeat(2,minmax(0,1fr))}}
      </style>
      <ha-card>
        <div class="body">
          <header><h2 id="title"></h2><span class="state" id="flame"></span></header>
          <p class="muted" id="backend" role="status"></p>
          <div class="live">
            <div class="metric"><small>На улице</small><strong id="outdoor">—</strong></div>
            <div class="metric"><small>В доме</small><strong id="indoor">—</strong></div>
            <div class="metric"><small>Уставка</small><strong id="setpoint">—</strong></div>
            <div class="metric"><small>Мощность</small><strong id="power">—</strong></div>
          </div>
          <div class="periods" role="group" aria-label="Период расхода">
            ${Object.entries(PERIODS).map(([key, label]) =>
              `<button type="button" data-period="${key}" aria-pressed="${key === this.period}">${label}</button>`).join('')}
          </div>
          <div class="values">
            <div class="metric"><h3>По счётчику</h3><strong id="meterVolume">—</strong><small id="meterCoverage"></small></div>
            <div class="metric"><h3>Расчёт по котлу</h3><strong id="estimatedVolume">—</strong><small id="estimatedCost"></small></div>
          </div>
          <div class="report">
            <small id="energy"></small>
            <small id="periodContext"></small>
            <small id="roomTrend"></small>
            <small id="lastInterval"></small>
            <small id="calibration"></small>
          </div>
          <details>
            <summary>Показания счётчика</summary>
            <p class="muted" id="lastReading"></p>
            <form id="readingForm" autocomplete="off">
              <div class="entry">
                <label>Полное показание, м³<input id="meter" type="text" inputmode="decimal" required></label>
                <button class="primary" id="saveMeter">Записать</button>
              </div>
              <label class="checkbox"><input type="checkbox" id="otherGas">Работала плита или другой газовый прибор с прошлого замера</label>
            </form>
            <p class="feedback" id="readingStatus" role="status"></p>
            <table><thead><tr><th scope="col">Замер</th><th scope="col">Счётчик</th><th scope="col">Разница</th><th scope="col">Тепло*</th></tr></thead><tbody id="readingRows"></tbody></table>
            <small>* Оценка по котлу. Звёздочка в строке означает неполную телеметрию.</small>
          </details>
          <details>
            <summary id="tariffHeading">Тариф</summary>
            <form id="tariffForm" class="entry" autocomplete="off">
              <label>Цена за м³, ₽<input id="rate" type="text" inputmode="decimal" required></label>
              <button id="saveRate">Сохранить</button>
            </form>
            <p class="feedback" id="tariffStatus" role="status"></p>
          </details>
        </div>
      </ha-card>`;

    for (const button of this.shadowRoot.querySelectorAll('[data-period]')) {
      button.addEventListener('click', () => {
        this.period = button.dataset.period;
        this.renderPeriod();
      });
    }
    this.node('readingForm').addEventListener('submit', event => {
      event.preventDefault();
      const value = formNumber(this.node('meter').value, 999999999.999);
      if (value === null) {
        this.feedback('readingStatus', ERRORS.invalid_reading);
        return;
      }
      this.save('add_reading', {value, other_gas: this.node('otherGas').checked}, 'readingStatus');
    });
    this.node('tariffForm').addEventListener('submit', event => {
      event.preventDefault();
      const rub_m3 = formNumber(this.node('rate').value, 10000);
      if (rub_m3 === null) {
        this.feedback('tariffStatus', ERRORS.invalid_tariff);
        return;
      }
      this.save('set_tariff', {rub_m3}, 'tariffStatus');
    });
    this.controls();
  }

  async refresh() {
    if (!this.isConnected || !this.currentHass || !this.config || this.busy || this.loading) return;
    this.requested = true;
    this.loading = true;
    const sequence = ++this.sequence;
    try {
      const response = await this.currentHass.callWS({type: 'baxi_gas/summary'});
      if (sequence !== this.sequence) return;
      this.snapshot = response;
      this.render();
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.snapshot = null;
      this.show('backend', ERRORS[error?.code] || 'Журнал газа временно недоступен.');
      for (const id of ['outdoor', 'indoor', 'setpoint', 'power', 'lastInterval', 'roomTrend', 'calibration']) {
        this.show(id, '');
      }
      this.show('flame', 'Статус горелки —');
      this.node('flame').dataset.on = 'false';
      this.renderPeriod();
    } finally {
      this.loading = false;
      this.controls();
    }
  }

  feedback(id, message, ok = false) {
    this.show(id, message);
    this.node(id).dataset.ok = String(ok);
  }

  async save(action, data, statusId) {
    if (this.busy || !this.snapshot || this.currentHass.user?.is_admin !== true) return;
    this.busy = true;
    this.sequence++;
    this.controls();
    this.feedback(statusId, '');
    try {
      this.snapshot = await this.currentHass.callWS({type: `baxi_gas/${action}`, ...data});
      if (action === 'add_reading') {
        this.node('meter').value = '';
        this.node('otherGas').checked = false;
      } else {
        this.node('rate').value = '';
      }
      this.render();
      this.feedback(statusId, action === 'add_reading' ? 'Показание сохранено.' : 'Тариф сохранён для новых расчётов.', true);
    } catch (error) {
      this.feedback(statusId, ERRORS[error?.code] || 'Не удалось сохранить запись.');
    } finally {
      this.busy = false;
      this.controls();
    }
  }

  renderPeriod() {
    for (const button of this.shadowRoot.querySelectorAll('[data-period]')) {
      button.setAttribute('aria-pressed', String(button.dataset.period === this.period));
    }
    const row = this.snapshot?.periods?.[this.period] || {};
    const percent = value => number(value * 100, '%', 0);
    this.show('meterVolume', number(row.meter_m3, 'м³', 3));
    const measuredCost = row.meter_rub == null ? '' : number(row.meter_rub, '₽', 2) + ' · ';
    this.show('meterCoverage', row.meter_m3 == null ? 'Нет двух замеров внутри периода' : `${measuredCost}Замерами покрыто ${percent(row.meter_coverage)}`);
    this.show('estimatedVolume', number(row.m3, 'м³', 2));
    const rub = row.rub != null ? number(row.rub, '₽', 2) : 'Стоимость —';
    this.show('estimatedCost', row.m3 == null ? 'Ожидаю калибровку и телеметрию' :
      `${rub} · расчётом покрыто ${percent(row.estimate_coverage)}${row.rub != null && row.priced_coverage < row.estimate_coverage ? ' · тариф частичный' : ''}`);
    this.show('energy', row.kwh == null ? '' : `Тепло ${number(row.kwh, 'кВт·ч')} · данные за ${percent(row.power_coverage)} периода`);
    const labels = {outdoor:'улица', indoor:'дом', setpoint:'уставка', modulation:'модуляция'};
    const conditions = Object.entries(row.context || {}).filter(([, value]) => Number.isFinite(value))
      .map(([key, value]) => `${labels[key]} ${number(value, key === 'modulation' ? '%' : '°C')}`);
    this.show('periodContext', conditions.length ? `В среднем: ${conditions.join(' · ')}` : '');
  }

  render() {
    const data = this.snapshot;
    const live = data.live;
    this.show('backend', data.has_power_source ? '' : 'Можно записывать счётчик. Для оценки выберите датчик мощности в настройках интеграции.');
    for (const field of ['outdoor', 'indoor', 'setpoint']) this.show(field, number(live[field], '°C'));
    this.show('power', number(live.power, 'кВт'));
    this.show('flame', live.flame === 'on' ? 'Горелка работает' : live.flame === 'off' ? 'Горелка выключена' : 'Статус горелки —');
    this.node('flame').dataset.on = String(live.flame === 'on');
    const calibration = data.calibration;
    this.show('calibration', calibration.coefficient === null ?
      `Калибровка ${calibration.intervals}/3 подходящих интервала` :
      `Калибровка ${number(calibration.coefficient, 'м³/кВт·ч', 4)} · интервалов ${calibration.intervals}`);
    this.show('tariffHeading', data.tariff == null ? 'Тариф' : `Тариф ${number(data.tariff, '₽/м³', 3)}`);
    const trend = {warming:'Прогрев дома', cooling:'Дом остывает', stable:'Температура дома стабильна'}[data.room_trend];
    this.show('roomTrend', trend ? `${trend} · по двум завершённым часам` : '');
    this.renderPeriod();
    this.renderLog(data);
  }

  renderLog(data) {
    const date = new Intl.DateTimeFormat('ru-RU', {
      timeZone: data.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    const time = reading => date.format(new Date(reading.at * 1000));
    const latest = data.readings[0];
    this.show('lastReading', latest ? `Последнее показание ${number(latest.value, 'м³', 3)} · ${time(latest)}` : 'Внесите первое показание для точки отсчёта.');
    const interval = latest?.m3 == null ? '' : `Последний интервал ${number(latest.m3, 'м³', 3)}` +
      (latest.rub == null ? '' : ' · ' + number(latest.rub, '₽', 2)) +
      (latest.expected_m3 == null ? '' : ' · прогноз был ' + number(latest.expected_m3, 'м³', 3));
    this.show('lastInterval', interval);
    const rows = data.readings.map(reading => {
      const row = document.createElement('tr');
      const heat = reading.coverage ? number(reading.kwh, 'кВт·ч') + (reading.coverage < 0.95 ? '*' : '') : '—';
      const cells = [
        time(reading),
        number(reading.value, 'м³', 3),
        number(reading.m3, 'м³', 3),
        heat,
      ];
      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    });
    this.node('readingRows').replaceChildren(...rows);
  }
}

if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, BaxiGasCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TYPE,
    name: 'Газ и котёл Baxi',
    description: `Показания счётчика, расчёт газа и стоимость · ${CARD_VERSION}`,
  });
}
