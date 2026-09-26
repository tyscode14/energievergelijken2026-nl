/*
 * Daisycon energy widget: drop offers whose price the feed miscalculates.
 *
 * A contract with a one-month term and a welcome bonus comes back from the products API with the
 * whole bonus subtracted from a single month (discount_per_month = discount_total) and a placeholder
 * 999.99 as discount_per_year. The month price goes negative, and because the widget sorts on that
 * month price the offer always lands at #1. Seen 26 Sept 2026 on Budget Thuis "Dynamisch".
 *
 * The widget fetches through jQuery XHR and reads responseText, so the products response is
 * filtered there, before the widget sees it. Only offers matching all three conditions are dropped:
 * term of one month or less, a bonus above zero, and a negative month price. Genuine negative prices
 * (solar feed-in exceeding costs, no bonus involved) stay. Must load before the widget's app.js.
 */
(function () {
  if (window.__dcNegFix || !window.XMLHttpRequest) return;
  window.__dcNegFix = true;

  var X = XMLHttpRequest.prototype;
  var open = X.open;
  var text = Object.getOwnPropertyDescriptor(X, 'responseText');
  var resp = Object.getOwnPropertyDescriptor(X, 'response');
  if (!text || !text.get || !resp || !resp.get) return;

  var PRODUCTS = /daisycon\.tools\/api\/energy\/[^?]*\/products(\?|$)/;

  function broken(p) {
    try {
      var info = p.product.product_information;
      var prices = p.product.product_prices;
      var bonus = prices.action ? Number(prices.action.discount_total) : 0;
      return Number(info.duration) <= 1 && bonus > 0 && Number(prices.total_month_cost_including_discount) < 0;
    } catch (e) {
      return false;
    }
  }

  function clean(raw) {
    try {
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.data)) return raw;
      var before = d.data.length;
      d.data = d.data.filter(function (p) { return !broken(p); });
      var dropped = before - d.data.length;
      if (!dropped) return raw;
      if (d.pagination && typeof d.pagination.total_count === 'number') d.pagination.total_count -= dropped;
      window.__dcNegFixDropped = (window.__dcNegFixDropped || 0) + dropped;
      return JSON.stringify(d);
    } catch (e) {
      return raw;
    }
  }

  function filtered(xhr, raw) {
    if (!xhr.__dcProducts || xhr.readyState !== 4 || typeof raw !== 'string') return raw;
    if (xhr.__dcRaw !== raw) { xhr.__dcRaw = raw; xhr.__dcClean = clean(raw); }
    return xhr.__dcClean;
  }

  X.open = function (method, url) {
    this.__dcProducts = PRODUCTS.test(String(url));
    return open.apply(this, arguments);
  };
  Object.defineProperty(X, 'responseText', {
    configurable: true, enumerable: text.enumerable,
    get: function () { return filtered(this, text.get.call(this)); }
  });
  Object.defineProperty(X, 'response', {
    configurable: true, enumerable: resp.enumerable,
    get: function () {
      var r = resp.get.call(this);
      return (this.responseType === '' || this.responseType === 'text') ? filtered(this, r) : r;
    }
  });
})();
