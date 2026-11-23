// Token Radar console: reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a per-protocol drawer with the model's
// own arithmetic and the protocol's farm plan, and the live-token view.
// No network: every byte shown is already in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var root = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }

  // The radar-2 model, recomputed in the page from the same snapshot figures,
  // so the number the drawer shows can be checked against board.json's row.
  function impliedOf(row, m) {
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var gm = 1 + (g / 100) * m.growth_weight;
    var am = row.age_days === null ? m.unknown_age_multiplier
      : m.age_floor + (Math.min(Math.max(row.age_days, 0), m.age_cap_days) / m.age_cap_days) * m.age_range;
    var bm = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_cap) * m.breadth_step;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * gm * am * bm));
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('watch') === '1') state.watch = true;
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.watch) p.set('watch', '1');
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortRows(list) {
    var key = state.sort;
    var d = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -d;
      if (av > bv) return d;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function optionList(values, current, allLabel) {
    return '<option value="all">' + esc(allLabel) + '</option>' +
      values.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
  }
  function sortBtn(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '';
    return '<button type="button" data-sort="' + key + '">' + esc(label) + esc(arrow) + '</button>';
  }

  function mastHtml() {
    return '<header class="mast"><div class="brand"><span class="dot"></span><b>Token Radar</b></div>' +
      '<div class="meta"><span>Snapshot ' + esc(DATA.as_of) + '</span><span>DefiLlama protocol index</span><span>' +
      esc(DATA.model_version) + ' model</span></div></header>';
  }
  function introHtml() {
    return '<section class="intro"><div><h1>' + DATA.watchlist_size +
      ' watchlist protocols, ranked by implied value</h1><p>The watchlist is the floor: every protocol with at least <b>$' +
      Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record</b>. The board ranks <b>every</b> protocol in the snapshot ' +
      'that records no token and could plausibly issue one of its own — ' + DATA.board_size + ' rows — so the early ones below the floor are in the ranking, not beside it. ' +
      'Exchanges, versioned pools and wrapped, staked or bridged products are set aside: they are not launches waiting to happen. ' +
      'Implied value is the model\u2019s claim about what a token would be worth if the protocol\u2019s record stayed as it is. It is not a price, and it does not predict a launch.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="stat"><span>Pre-token rows ranked</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="stat"><span>Top implied value</span><b>' + money(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0) + '</b></div>' +
      '<div class="stat"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>' +
      '</div></section>';
  }
  function toolbarHtml() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    return '<div class="toolbar">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Name, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat" aria-label="Filter by category">' + optionList(cats, state.category, 'All categories') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain" aria-label="Filter by chain">' + optionList(chains, state.chain, 'All chains') + '</select></div>' +
      '<label class="check"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<div class="field"><label for="tab">View</label><select id="tab" aria-label="Board or live-token view">' +
      '<option value="board"' + (state.tab === 'board' ? ' selected' : '') + '>Pre-token board</option>' +
      '<option value="live"' + (state.tab === 'live' ? ' selected' : '') + '>Live-token view</option></select></div>' +
      '<span class="shown" id="shown"></span></div>';
  }
  function boardTableHtml(list) {
    if (list.length === 0) {
      return '<div class="card"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category or chain to see the board again.</p>' +
        '<button class="btn" type="button" id="clear">Clear filters</button></div></div>';
    }
    var max = list[0] ? list[0].implied_value_usd : 1;
    var rows = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var chains = (r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain';
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" aria-selected="' + (state.selected === r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><div class="who"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + gc + '">' + growth + '</td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td class="num">' + (r.chains || []).length + '</td>' +
        '<td><div class="meter"><i aria-hidden="true"><b style="width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%"></b></i><span class="num">' + money(r.implied_value_usd) + '</span></div></td>' +
        '<td>' + (r.watchlist ? '<span class="tag watch">watchlist</span>' : '<span class="tag">early</span>') + '</td></tr>';
    }).join('');
    return '<div class="card"><div class="scroller"><table>' +
      '<caption>Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.</caption>' +
      '<thead><tr><th scope="col">' + sortBtn('implied', 'Rank') + '</th><th scope="col">' + sortBtn('name', 'Protocol') + '</th>' +
      '<th scope="col">' + sortBtn('tvl', 'TVL') + '</th><th scope="col">' + sortBtn('growth', '7d') + '</th>' +
      '<th scope="col">' + sortBtn('age', 'Age') + '</th><th scope="col">' + sortBtn('chains', 'Chains') + '</th>' +
      '<th scope="col">' + sortBtn('implied', 'Implied value') + '</th><th scope="col">List</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }
  function liveTableHtml() {
    var rows = DATA.live.map(function (r) {
      var chains = (r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain';
      return '<tr><td><span class="tag">live</span></td>' +
        '<td><div class="who"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc(chains) + '</span></div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td></tr>';
    }).join('');
    return '<div class="card live"><div class="scroller"><table>' +
      '<caption>Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }
  function explainerHtml() {
    var m = DATA.model;
    return '<section class="card explainer"><h2>How implied value is computed</h2>' +
      '<p>One function scores every protocol, from the snapshot\u2019s own figures only. No protocol name is special-cased, and no row is hand-picked. ' +
      'Age is the time since the protocol was first listed — how long it has run with no token. Breadth counts the chains its TVL sits on.</p>' +
      '<div class="formula">implied = round( tvl_usd × ' + m.base_multiple + ' × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × age × breadth )<br>' +
      'age = ' + m.age_floor + ' + min(age_days, ' + m.age_cap_days + ') / ' + m.age_cap_days + ' × ' + m.age_range + ' (unknown age: ' + m.unknown_age_multiplier + ')<br>' +
      'breadth = 1 + min(chains − 1, ' + m.breadth_cap + ') × ' + m.breadth_step + '</div>' +
      '<p>The board is every protocol that records no token and could plausibly issue one of its own: ' + DATA.board_size + ' rows, watchlist and early alike. Exchanges, versioned pools and wrapped, staked or bridged products are set aside, and a protocol that records a token is never ranked here.</p></section>';
  }
  function drawerHtml(row) {
    if (!row) return '<section class="card drawer" id="drawer" hidden></section>';
    var m = DATA.model;
    var again = impliedOf(row, m);
    var ok = again === row.implied_value_usd;
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span>' + esc(tail) + '</span></li>';
    }).join('');
    return '<section class="card drawer" id="drawer" aria-label="Protocol detail">' +
      '<div class="drawer-head"><div><span class="tag watch">Rank ' + row.rank + ' of ' + DATA.board_size + '</span>' +
      '<h2>' + esc(row.name) + '</h2><p class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') +
      (row.watchlist ? ' · on the watchlist' : ' · early, below the watchlist floor') + '</p></div>' +
      '<button class="close" type="button" id="close-drawer" aria-label="Close details">Close</button></div>' +
      '<div class="grid2"><div><h3>Implied value</h3><div class="kv">' +
      '<div><span>TVL</span><b>' + money(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b>' + ageLabel(row.age_days) + '</b></div>' +
      '<div><span>Chains</span><b>' + (row.chains || []).length + '</b></div>' +
      '<div><span>Growth multiplier</span><b>' + row.model.growth_multiplier + '</b></div>' +
      '<div><span>Age multiplier</span><b>' + row.model.age_multiplier + '</b></div>' +
      '<div><span>Breadth multiplier</span><b>' + row.model.breadth_multiplier + '</b></div>' +
      '<div><span>Implied value</span><b>' + money(row.implied_value_usd) + '</b></div></div>' +
      '<p class="check-line">Model ' + esc(DATA.model_version) + ': the page recomputes this row as <b>' + money(again) + '</b> — ' +
      (ok ? 'the same number board.json carries.' : 'which differs from the board: the data would be stale.') + ' This is an estimate, not a price.</p></div>' +
      '<div><h3>Farm plan</h3><ol class="plan">' + steps + '</ol></div></div>' +
      '<p class="note">“Records no token” means the snapshot carries no token for this protocol; it is not proof none exists. ' +
      'Never pay anyone to claim for you, and claim only from a link the protocol itself publishes.</p></section>';
  }

  function findRow(slug) {
    return DATA.rows.filter(function (r) { return r.slug === slug; })[0] || null;
  }
  function select(slug) {
    state.selected = slug;
    writeHash();
    render();
    var d = document.getElementById('drawer');
    if (d) d.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    var list = state.tab === 'board' ? sortRows(visibleRows()) : [];
    var sel = state.selected ? findRow(state.selected) : null;
    root.innerHTML = '<div class="wrap">' + mastHtml() + introHtml() + toolbarHtml() +
      (state.tab === 'board' ? boardTableHtml(list) : liveTableHtml()) +
      drawerHtml(sel) +
      (state.tab === 'board' ? explainerHtml() : '') + '</div>';
    root.setAttribute('aria-busy', 'false');
    var shown = document.getElementById('shown');
    if (shown) shown.textContent = state.tab === 'board' ? list.length + ' of ' + DATA.board_size + ' rows shown' : DATA.live_size + ' live-token protocols';
    wire();
  }

  function wire() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); var nq = document.getElementById('q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = document.getElementById('chain');
    if (ch) ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var w = document.getElementById('watch');
    if (w) w.addEventListener('change', function () { state.watch = w.checked; writeHash(); render(); });
    var tab = document.getElementById('tab');
    if (tab) tab.addEventListener('change', function () { state.tab = tab.value; render(); });
    var clear = document.getElementById('clear');
    if (clear) clear.addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); });
    var close = document.getElementById('close-drawer');
    if (close) close.addEventListener('click', function () { state.selected = null; writeHash(); render(); });
    root.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = -1; }
        render();
      });
    });
    root.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(tr.getAttribute('data-slug')); }
      });
    });
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; writeHash(); render(); }
  });
})();
