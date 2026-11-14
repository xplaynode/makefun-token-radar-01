// Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board with sorting and filters, a detail view for every protocol (the model's own
// arithmetic, recomputed on the page from the snapshot's figures, and the full farm plan), the
// products set aside, and the live tokens at the market's own values. No network: every byte it
// shows is in data.js.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var M = D.model;
  var view = document.getElementById('view');
  var state = { view: 'board', q: '', cat: 'all', chain: 'all', tier: 'all', sort: 'rank', dir: 1, slug: null };

  /* ---------- formatting ---------- */
  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(3); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ---------- the model, recomputed on the page ----------
     The same arithmetic as lib/model.ts, from the snapshot figures the row itself carries and
     the multiples table above, so a reader can check any row without trusting board.json. */
  function multipleFor(category) {
    var key = category === null ? 'Uncategorized' : category;
    for (var i = 0; i < D.multiples.length; i++) if (D.multiples[i].category === key) return D.multiples[i];
    return null;
  }
  function recompute(r) {
    var entry = multipleFor(r.category);
    var mult = entry ? entry.multiple : D.global_multiple;
    var chg = r.change_7d === null ? 0 : Math.min(M.momentum_cap_pct, Math.max(M.momentum_floor_pct, r.change_7d));
    var mom = 1 + (chg / 100) * M.momentum_weight;
    var age = r.age_days === null ? D.median_age_days : r.age_days;
    var sea = M.seasoning_base + M.seasoning_range * (Math.min(Math.max(age, 0), M.seasoning_days) / M.seasoning_days);
    var br = 1 + M.breadth_per_chain * Math.min(Math.max(r.chains.length - 1, 0), M.breadth_max_extra_chains);
    return Math.max(1, Math.round(r.tvl_usd * mult * mom * sea * br));
  }

  /* ---------- header and method ---------- */
  function renderMeta() {
    var m = document.getElementById('meta');
    m.innerHTML =
      '<strong>' + D.protocols_scanned + '</strong> protocols scanned<br>' +
      '<strong>' + D.board_size + '</strong> candidates ranked · <strong>' + D.watchlist_size + '/' + D.watchlist_size + '</strong> watchlist<br>' +
      'snapshot as of <strong>' + D.as_of + '</strong>';
    var box = document.getElementById('multiples');
    box.appendChild(el('p', 'mult-cap', 'Category multiples measured from this snapshot (tokenised protocols only; global median x' + D.global_multiple.toFixed(3) + '; the eight deepest peer sets — every category\u2019s multiple is in the data and on each row\u2019s detail)'));
    var grid = el('div', 'mult-grid');
    var shown = D.multiples.slice(0, 8);
    [shown.slice(0, 4), shown.slice(4)].forEach(function (half) {
      var t = el('table');
      var head = el('tr');
      ['Category', 'Peers', 'Peer median', 'Multiple used'].forEach(function (h) { head.appendChild(el('th', null, h)); });
      t.appendChild(head);
      half.forEach(function (row) {
        var tr = el('tr');
        tr.appendChild(el('td', null, row.category));
        tr.appendChild(el('td', null, String(row.peers)));
        tr.appendChild(el('td', null, row.peer_median === null ? 'n/a' : 'x' + row.peer_median.toFixed(3)));
        tr.appendChild(el('td', null, 'x' + row.multiple.toFixed(3)));
        t.appendChild(tr);
      });
      grid.appendChild(t);
    });
    box.appendChild(grid);
  }

  /* ---------- controls ---------- */
  function fillControls() {
    var catSel = document.getElementById('cat');
    var cats = {};
    D.rows.forEach(function (r) { var c = r.category || 'Uncategorized'; cats[c] = (cats[c] || 0) + 1; });
    catSel.appendChild(new Option('All categories', 'all'));
    Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a] || (a < b ? -1 : 1); }).forEach(function (c) {
      catSel.appendChild(new Option(c + ' (' + cats[c] + ')', c));
    });
    var chainSel = document.getElementById('chain');
    var chains = {};
    D.rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    chainSel.appendChild(new Option('All chains', 'all'));
    Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || (a < b ? -1 : 1); }).forEach(function (c) {
      chainSel.appendChild(new Option(c + ' (' + chains[c] + ')', c));
    });
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value.toLowerCase(); render(); });
    catSel.addEventListener('change', function (e) { state.cat = e.target.value; render(); });
    chainSel.addEventListener('change', function (e) { state.chain = e.target.value; render(); });
    document.getElementById('tier').addEventListener('change', function (e) { state.tier = e.target.value; render(); });
  }

  function filteredRows() {
    var rows = D.rows.filter(function (r) {
      if (state.tier === 'watchlist' && !r.watchlist) return false;
      if (state.tier === 'early' && r.watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorized') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q && (r.name + ' ' + (r.category || '') + ' ' + r.slug).toLowerCase().indexOf(state.q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'name') {
        var na = a.name.toLowerCase(), nb = b.name.toLowerCase();
        if (na !== nb) return (na < nb ? -1 : 1) * dir;
        return a.rank - b.rank;
      }
      if (key === 'change') { va = a.change_7d === null ? -Infinity : a.change_7d; vb = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'mult') { va = a.model.category_multiple; vb = b.model.category_multiple; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else { va = a.rank; vb = b.rank; }
      if (va !== vb) return (va - vb) * dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  /* ---------- board view ---------- */
  var SORTS = [
    ['rank', '#'], ['name', 'Protocol'], ['tvl', 'TVL'], ['change', '7d'], ['age', 'Age'], ['mult', 'x Mult'], ['implied', 'Implied value'],
  ];
  function renderBoard() {
    var rows = filteredRows();
    document.getElementById('count').textContent = rows.length + ' of ' + D.board_size + ' candidates';
    var t = el('table', 'board');
    var thead = el('thead');
    var hr = el('tr');
    SORTS.forEach(function (s, i) {
      var th = el('th', i >= 2 ? 'sortable' : 'sortable l', s[1] + (state.sort === s[0] ? (state.dir === 1 ? ' ^' : ' v') : ''));
      if (i < 2) th.className = 'sortable l';
      th.addEventListener('click', function () {
        if (state.sort === s[0]) state.dir = -state.dir;
        else { state.sort = s[0]; state.dir = s[0] === 'rank' || s[0] === 'name' ? 1 : -1; }
        render();
      });
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = el('tbody');
    var max = rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 0);
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, String(r.rank)));
      var nameTd = el('td', 'l');
      nameTd.appendChild(el('span', 'name', r.name));
      var badge = el('span', 'badge ' + (r.watchlist ? 'wl' : 'early'), r.watchlist ? 'WATCHLIST' : 'EARLY');
      nameTd.appendChild(badge);
      nameTd.appendChild(el('div', 'sub', (r.category || 'Uncategorized') + ' · ' + (r.chains.length ? r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') : 'no chain listed')));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', null, fmtUsd(r.tvl_usd)));
      var ch = el('td', r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg', fmtPct(r.change_7d));
      tr.appendChild(ch);
      tr.appendChild(el('td', null, fmtAge(r.age_days)));
      tr.appendChild(el('td', null, fmtMult(r.model.category_multiple)));
      var val = el('td', 'val', fmtUsd(r.implied_value_usd));
      var bar = el('span', 'bar');
      bar.style.width = Math.max(3, Math.round((r.implied_value_usd / max) * 90)) + 'px';
      val.appendChild(bar);
      tr.appendChild(val);
      tr.addEventListener('click', function () { location.hash = '#p/' + r.slug; });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    view.innerHTML = '';
    if (rows.length === 0) view.appendChild(el('p', 'empty', 'No candidate matches those filters.'));
    else view.appendChild(t);
  }

  /* ---------- detail view ---------- */
  function parseStep(s) {
    var ci = s.indexOf(' Cost: ');
    var ti = s.lastIndexOf(' Time: ');
    if (ci < 0 || ti < 0 || ti < ci) return { text: s, cost: null, time: null };
    return {
      text: s.slice(0, ci),
      cost: s.slice(ci + 7, ti).replace(/\.$/, ''),
      time: s.slice(ti + 7).replace(/\.$/, ''),
    };
  }
  function kv(parent, k, v) {
    parent.appendChild(el('dt', null, k));
    parent.appendChild(el('dd', null, v));
  }
  function renderDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    view.innerHTML = '';
    if (!r) { view.appendChild(el('p', 'empty', 'That protocol is not on the board.')); return; }
    var back = el('a', 'back', '<- Back to the board');
    back.href = '#board';
    view.appendChild(back);

    var head = el('div', 'detail-head');
    head.appendChild(el('h2', null, '#' + r.rank + ' ' + r.name));
    head.appendChild(el('span', 'badge ' + (r.watchlist ? 'wl' : 'early'), r.watchlist ? 'WATCHLIST' : 'EARLY — BELOW THE $50M FLOOR'));
    view.appendChild(head);
    view.appendChild(el('p', 'sub', (r.category || 'Uncategorized') + ' · records no token in the snapshot · implied launch value ' + fmtUsd(r.implied_value_usd)));

    var grid = el('div', 'detail-grid');

    var rec = el('section', 'card rec');
    rec.appendChild(el('h3', null, 'The record'));
    var dl = el('dl', 'kv');
    kv(dl, 'TVL', fmtUsd(r.tvl_usd));
    kv(dl, '7-day TVL change', fmtPct(r.change_7d));
    kv(dl, 'Chains', r.chains.length ? r.chains.join(', ') : 'none listed');
    kv(dl, 'Tracked since', r.listed_at || 'not reported');
    kv(dl, 'Age with no token', fmtAge(r.age_days));
    kv(dl, 'Watchlist (TVL >= $50M)', r.watchlist ? 'yes' : 'no — an early signal');
    rec.appendChild(dl);
    grid.appendChild(rec);

    var mod = el('section', 'card mod');
    mod.appendChild(el('h3', null, "The model's arithmetic"));
    var entry = multipleFor(r.category);
    var eq = el('p', 'eq');
    function chip(label, val) {
      var s = el('span', 'f', label + ' ' + val);
      eq.appendChild(s);
    }
    chip('TVL', fmtUsd(r.tvl_usd));
    eq.appendChild(el('span', 'op', 'x'));
    chip('multiple', fmtMult(r.model.category_multiple));
    eq.appendChild(el('span', 'op', 'x'));
    chip('momentum', 'x' + r.model.momentum_factor.toFixed(3));
    eq.appendChild(el('span', 'op', 'x'));
    chip('seasoning', 'x' + r.model.seasoning_factor.toFixed(3));
    eq.appendChild(el('span', 'op', 'x'));
    chip('breadth', 'x' + r.model.breadth_factor.toFixed(3));
    eq.appendChild(el('span', 'op', '='));
    eq.appendChild(el('span', 'res', fmtUsd(r.implied_value_usd)));
    mod.appendChild(eq);
    var note = entry
      ? 'The multiple is the shrunk median of ' + entry.peers + ' tokenised ' + entry.category + ' peer' + (entry.peers === 1 ? '' : 's') + ' in this snapshot (peer median x' + (entry.peer_median === null ? 'n/a' : entry.peer_median.toFixed(3)) + ').'
      : 'This category has no tokenised peer in the snapshot, so the multiple is the global median across all categories.';
    if (entry && entry.peers < 3) note += ' A thin peer set: the shrinkage toward the global median does most of the work, by design.';
    mod.appendChild(el('p', 'sub', note));
    var again = recompute(r);
    var tol = Math.max(2, r.implied_value_usd * 0.001);
    if (Math.abs(again - r.implied_value_usd) <= tol) {
      mod.appendChild(el('p', 'sub', 'Recomputed on this page from the figures above: ' + fmtUsd(again) + ' — the board\u2019s figure, up to the printed factors\u2019 rounding.'));
    }
    grid.appendChild(mod);

    var plan = el('section', 'card plan');
    plan.appendChild(el('h3', null, 'The farm plan'));
    var totals = el('p');
    [['Working capital', fmtUsd(r.plan.capital_usd)], ['Gas, whole plan', 'about $' + r.plan.gas_usd], ['Hold', r.plan.hold_days + ' days'], ['Cadence', r.plan.minutes_per_week + ' min/week']].forEach(function (p) {
      var pill = el('span', 'pill');
      pill.appendChild(document.createTextNode(p[0] + ' '));
      pill.appendChild(el('b', null, p[1]));
      totals.appendChild(pill);
    });
    plan.appendChild(totals);
    var ol = el('ol', 'plan');
    r.farm_steps.forEach(function (s) {
      var st = parseStep(s);
      var li = el('li', null, st.text);
      if (st.cost !== null) {
        var ct = el('span', 'ct');
        var c1 = el('span', 'pill'); c1.appendChild(document.createTextNode('Cost ')); c1.appendChild(el('b', null, st.cost));
        var c2 = el('span', 'pill'); c2.appendChild(document.createTextNode('Time ')); c2.appendChild(el('b', null, st.time));
        ct.appendChild(c1); ct.appendChild(c2);
        li.appendChild(ct);
      }
      ol.appendChild(li);
    });
    plan.appendChild(ol);
    grid.appendChild(plan);

    view.appendChild(grid);
  }

  /* ---------- products and live views ---------- */
  function renderProducts() {
    document.getElementById('count').textContent = D.products_size + ' products set aside';
    view.innerHTML = '';
    view.appendChild(el('p', 'sub', 'Pre-token by the record, but a wrapped, staked, bridged or exchange product of something that already trades — tracked here so the board never mistakes one for a launch.'));
    var t = el('table', 'plain');
    var hr = el('tr');
    ['Protocol', 'Category', 'TVL', '7d', 'Why set aside'].forEach(function (h, i) { hr.appendChild(el('th', i === 0 || i === 4 ? 'l' : '', h)); });
    t.appendChild(hr);
    D.products.forEach(function (p) {
      var tr = el('tr');
      tr.appendChild(el('td', 'l name', p.name));
      tr.appendChild(el('td', 'l', p.category || 'Uncategorized'));
      tr.appendChild(el('td', null, fmtUsd(p.tvl_usd)));
      tr.appendChild(el('td', p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg', fmtPct(p.change_7d)));
      tr.appendChild(el('td', 'l reason', p.reason));
      t.appendChild(tr);
    });
    view.appendChild(t);
  }
  function renderLive() {
    document.getElementById('count').textContent = D.live_size + ' live tokens shown';
    view.innerHTML = '';
    view.appendChild(el('p', 'sub', 'These protocols\u2019 tokens already trade, so the radar shows the market\u2019s own value and never ranks them as launches. Their market-cap-to-TVL ratios are the raw material of the board\u2019s category multiples.'));
    var t = el('table', 'plain');
    var hr = el('tr');
    ['Protocol', 'Category', 'TVL', 'Market cap', 'Mcap / TVL'].forEach(function (h, i) { hr.appendChild(el('th', i < 2 ? 'l' : '', h)); });
    t.appendChild(hr);
    D.live.forEach(function (p) {
      var tr = el('tr');
      var nm = el('td', 'l');
      nm.appendChild(el('span', 'name', p.name));
      if (p.symbol) nm.appendChild(el('span', 'sub', ' ' + p.symbol));
      tr.appendChild(nm);
      tr.appendChild(el('td', 'l', p.category || 'Uncategorized'));
      tr.appendChild(el('td', null, fmtUsd(p.tvl_usd)));
      tr.appendChild(el('td', null, fmtUsd(p.mcap_usd)));
      tr.appendChild(el('td', null, p.multiple === null ? 'n/a' : 'x' + p.multiple.toFixed(3)));
      t.appendChild(tr);
    });
    view.appendChild(t);
  }

  /* ---------- routing ---------- */
  function setViewButtons() {
    var btns = document.querySelectorAll('#views button');
    btns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === state.view); });
    document.getElementById('controls').style.display = state.view === 'board' ? '' : 'none';
    document.getElementById('method').style.display = state.view === 'board' ? '' : 'none';
  }
  function render() {
    setViewButtons();
    if (state.view === 'detail') renderDetail(state.slug);
    else if (state.view === 'products') renderProducts();
    else if (state.view === 'live') renderLive();
    else renderBoard();
  }
  function route() {
    var h = location.hash || '#board';
    if (h.indexOf('#p/') === 0) {
      state.view = 'detail';
      state.slug = decodeURIComponent(h.slice(3));
    } else if (h === '#products') state.view = 'products';
    else if (h === '#live') state.view = 'live';
    else {
      state.view = 'board';
      var qi = h.indexOf('?');
      if (qi >= 0) {
        var params = new URLSearchParams(h.slice(qi + 1));
        if (params.get('cat')) { state.cat = params.get('cat'); document.getElementById('cat').value = state.cat; }
        if (params.get('chain')) { state.chain = params.get('chain'); document.getElementById('chain').value = state.chain; }
        if (params.get('tier')) { state.tier = params.get('tier'); document.getElementById('tier').value = state.tier; }
        if (params.get('q')) { state.q = params.get('q').toLowerCase(); document.getElementById('q').value = params.get('q'); }
        if (params.get('sort')) state.sort = params.get('sort');
      }
    }
    render();
  }
  document.querySelectorAll('#views button').forEach(function (b) {
    b.addEventListener('click', function () { location.hash = '#' + b.getAttribute('data-view'); });
  });
  window.addEventListener('hashchange', route);

  renderMeta();
  fillControls();
  route();
})();
