const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

class Element {
  constructor() {
    this.dataset = {};
    this.attributes = {};
    this.handlers = {};
    this.textContent = '';
    this.children = [];
    this.value = '';
  }
  addEventListener(name, callback) { this.handlers[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(node) { this.children.push(node); }
  replaceChildren(...nodes) { this.children = nodes; }
}

class Shadow {
  constructor() { this.children = []; }
  set innerHTML(page) {
    this.children = [{}];
    this.nodes = Object.fromEntries([...page.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
    this.buttons = [...page.matchAll(/data-period="([^"]+)"/g)].map(([, period]) => {
      const node = new Element();
      node.dataset.period = period;
      return node;
    });
  }
  getElementById(id) { return this.nodes?.[id]; }
  querySelectorAll() { return this.buttons; }
}

function fixture() {
  const classes = {};
  const context = vm.createContext({
    HTMLElement: class {
      attachShadow() { this.shadowRoot = new Shadow(); }
      get isConnected() { return true; }
    },
    customElements: { get: type => classes[type], define: (type, handler) => { classes[type] = handler; } },
    document: { createElement: () => new Element() },
    window: {},
    setInterval, clearInterval,
  });
  const code = readFileSync(join(__dirname, '..', 'baxi-gas-card.js'), 'utf8');
  vm.runInContext(code, context);
  const card = new classes['baxi-gas-card']();
  card.setConfig({title: 'Тестовый Baxi'});
  return card;
}

const day = {m3: 4.5, rub: 36, kwh: 45, power_coverage: .96, estimate_coverage: .95, priced_coverage: .95, meter_m3: 5, meter_rub: 40, meter_coverage: .9};
const data = {
  live: {power: 12.5, outdoor: -10, indoor: 21, setpoint: 53, flame: 'on'},
  periods: {day, week: {...day, m3: 25}, month: {...day, m3: 60}, rolling30: {...day, m3: 75}},
  tariff: 8, timezone: 'Asia/Tomsk', has_power_source: true, room_trend: 'warming',
  readings: [{at: 1795514400, value: 1205, m3: 5, rub: 40, coverage: .96, kwh: 45}],
  calibration: {intervals: 3, coefficient: .1},
};

test('period selection, tariff, cumulative readings and fresh burner state', async () => {
  const card = fixture();
  const calls = [];
  card.currentHass = {user:{is_admin:true}, callWS: async message => { calls.push(message); return data; }};
  await card.refresh();
  assert.equal(card.node('title').textContent, 'Тестовый Baxi');
  assert.equal(card.node('flame').textContent, 'Горелка работает');
  assert.equal(card.node('power').textContent, '12,5 кВт');
  assert.equal(card.node('estimatedVolume').textContent, '4,5 м³');
  assert.match(card.node('estimatedCost').textContent, /36 ₽/);
  assert.match(card.node('meterCoverage').textContent, /40 ₽/);
  card.shadowRoot.buttons.find(button => button.dataset.period === 'rolling30').handlers.click();
  assert.equal(card.node('estimatedVolume').textContent, '75 м³');
  assert.equal(card.node('readingRows').children.length, 1);

  card.node('meter').value = '1205,123';
  card.node('otherGas').checked = true;
  card.node('readingForm').handlers.submit({preventDefault(){}});
  await new Promise(setImmediate);
  assert.equal(calls.at(-1).type, 'baxi_gas/add_reading');
  assert.equal(calls.at(-1).value, 1205.123);
  assert.equal(calls.at(-1).other_gas, true);
  assert.equal(card.node('meter').value, '');
  assert.equal(card.node('readingStatus').textContent, 'Показание сохранено.');

  card.node('rate').value = '8,25';
  card.node('tariffForm').handlers.submit({preventDefault(){}});
  await new Promise(setImmediate);
  assert.equal(calls.at(-1).type, 'baxi_gas/set_tariff');
  assert.equal(calls.at(-1).rub_m3, 8.25);
});

test('read-only users can see the ledger and loss of backend clears stale power', async () => {
  const card = fixture();
  let failed = false;
  card.currentHass = {user:{is_admin:false}, callWS: async () => {
    if (failed) throw {code:'not_loaded'};
    return data;
  }};
  await card.refresh();
  assert.equal(card.node('meter').disabled, true);
  assert.equal(card.node('meterVolume').textContent, '5 м³');
  failed = true;
  await card.refresh();
  assert.equal(card.node('flame').textContent, 'Статус горелки —');
  assert.equal(card.node('power').textContent, '');
  assert.match(card.node('backend').textContent, /Настройте интеграцию/);
});
