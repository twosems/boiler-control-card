const ShnekCard = customElements.get('shnek-control-card');

if (ShnekCard && !ShnekCard.prototype.__dailyConsumptionPatched) {
  const proto = ShnekCard.prototype;
  proto.__dailyConsumptionPatched = true;

  const originalFetchHistory = proto._fetchHistory;
  const originalRender = proto._render;

  proto._haTimeZone = function () {
    return this._hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  };

  proto._zonedParts = function (ts, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(ts));
    const out = {};
    for (const p of parts) if (p.type !== 'literal') out[p.type] = Number(p.value);
    return out;
  };

  proto._zonedDateTimeToMs = function (year, month, day, hour, minute, second, timeZone) {
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    let guess = targetUtc;
    for (let i = 0; i < 3; i += 1) {
      const p = this._zonedParts(guess, timeZone);
      const representedUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      guess += targetUtc - representedUtc;
    }
    return guess;
  };

  proto._todayStartMs = function () {
    const tz = this._haTimeZone();
    const now = Date.now();
    const p = this._zonedParts(now, tz);
    return this._zonedDateTimeToMs(p.year, p.month, p.day, 0, 0, 0, tz);
  };

  proto._fetchTodayStats = async function () {
    if (!this._hass || this._todayLoading) return;
    const entity = this._config.entity;
    if (!entity || !this._hass.states?.[entity]) return;

    const now = Date.now();
    const start = this._todayStartMs();
    const key = `${entity}|${start}|${Math.floor(now / 60000)}`;
    if (this._todayHistoryKey === key && this._todayStats) return;

    this._todayLoading = true;
    try {
      const res = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: new Date(start).toISOString(),
        end_time: new Date(now).toISOString(),
        entity_ids: [entity],
        include_start_time_state: true,
        significant_changes_only: false,
        minimal_response: true,
        no_attributes: true
      });
      const raw = Array.isArray(res)
        ? (Array.isArray(res[0]) ? res[0] : res)
        : (Array.isArray(res?.[entity]) ? res[entity] : []);
      const history = this._normalizeHistory(raw);
      const intervals = this._buildIntervals(history, start, now);
      const totalSec = intervals.reduce((sum, i) => sum + Math.max(0, ((i.open ? now : i.end) - i.start) / 1000), 0);
      this._todayStats = {
        start,
        totalSec,
        starts: intervals.length,
        kg: totalSec / 60 * this._feedRate()
      };
      this._todayHistoryKey = key;
      this._todayError = '';
    } catch (err) {
      this._todayError = String(err?.message || err || 'history unavailable');
    } finally {
      this._todayLoading = false;
      originalRender.call(this);
    }
  };

  proto._fetchHistory = async function (...args) {
    const result = await originalFetchHistory.apply(this, args);
    this._fetchTodayStats();
    return result;
  };

  proto._injectTodayConsumption = function () {
    const root = this.shadowRoot;
    const metrics = root?.querySelector('.metrics');
    if (!metrics || root.querySelector('.today-consumption')) return;

    const stats = this._todayStats;
    const strip = document.createElement('div');
    strip.className = 'today-consumption';
    strip.style.cssText = 'margin:9px 0 2px;padding:9px 12px;border-radius:12px;background:rgba(255,138,31,.09);border:1px solid rgba(255,138,31,.22);display:flex;align-items:center;gap:10px;min-height:34px;box-sizing:border-box;';

    const icon = document.createElement('ha-icon');
    icon.setAttribute('icon', 'mdi:calendar-today');
    icon.style.cssText = '--mdc-icon-size:20px;color:var(--shnek-orange,#ff8a1f);flex:0 0 auto;';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:var(--secondary-text-color,#9fb0c2);flex:1;min-width:0;';
    label.textContent = 'Сегодня · с 00:00';

    const value = document.createElement('strong');
    value.style.cssText = 'font-size:17px;white-space:nowrap;color:var(--primary-text-color,#fff);';
    value.textContent = stats ? this._fmtKg(stats.kg, 1) : (this._todayLoading ? '…' : '—');

    strip.append(icon, label, value);

    if (stats) {
      const extra = document.createElement('span');
      extra.style.cssText = 'font-size:10px;color:var(--secondary-text-color,#9fb0c2);white-space:nowrap;';
      extra.textContent = `${this._fmtDuration(stats.totalSec, true)} · ${stats.starts} вкл.`;
      strip.append(extra);
    }

    metrics.insertAdjacentElement('afterend', strip);
  };

  proto._render = function (...args) {
    const result = originalRender.apply(this, args);
    this._injectTodayConsumption();
    if (!this._todayStats && !this._todayLoading) queueMicrotask(() => this._fetchTodayStats());
    return result;
  };
}
