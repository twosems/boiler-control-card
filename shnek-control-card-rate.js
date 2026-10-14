const ShnekCardRate = customElements.get('shnek-control-card');

if (ShnekCardRate && !ShnekCardRate.prototype.__rate025Patched) {
  const proto = ShnekCardRate.prototype;
  proto.__rate025Patched = true;

  proto._feedRate = function () {
    const entityRate = Number(this._state(this._config.feed_rate_entity)?.state);
    if (Number.isFinite(entityRate) && entityRate > 0) return entityRate;
    const configured = Number(this._config.feed_rate);
    return Number.isFinite(configured) && configured > 0 ? configured : 0.25;
  };

  proto._setFeedRate = async function (value) {
    const entity = this._config.feed_rate_entity;
    const v = Math.max(0.1, Math.min(10, Math.round(Number(value) * 100) / 100));
    if (!entity || !this._state(entity)) return;
    try {
      await this._hass.callService('input_number', 'set_value', { value: v }, { entity_id: entity });
    } catch (err) {
      console.warn('Shnek Control Card: feed rate update failed', err);
    }
  };

  const originalRender = proto._render;
  proto._render = function (...args) {
    const result = originalRender.apply(this, args);
    const root = this.shadowRoot;
    const rate = this._feedRate();

    const rateValue = root?.querySelector('.rate-value strong');
    if (rateValue) rateValue.textContent = rate.toFixed(2).replace('.', ',');

    const slider = root?.querySelector('[data-rate]');
    if (slider) {
      slider.step = '0.01';
      slider.value = String(rate);
    }

    const minus = root?.querySelector('[data-rate-delta="-0.1"], [data-rate-delta="-0.01"]');
    if (minus) minus.dataset.rateDelta = '-0.01';
    const plus = root?.querySelector('[data-rate-delta="0.1"], [data-rate-delta="0.01"]');
    if (plus) plus.dataset.rateDelta = '0.01';

    const dailyLabel = root?.querySelector('.today-consumption div');
    if (dailyLabel) dailyLabel.textContent = 'Суточный расход';

    return result;
  };
}
