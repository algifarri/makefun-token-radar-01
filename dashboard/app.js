// Pre-Token Radar — Compass dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the trading set, a method panel with every category
// multiple, and a per-protocol drawer with the model's working and the protocol's farm plan.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var M = D.model;

  // Board row fields, by index (see lib/model.ts RadarRow):
  // 0 rank, 1 slug, 2 name, 3 category, 4 chains, 5 tvl, 6 change_7d, 7 age_days,
  // 8 implied, 9 multiple, 10 momentum, 11 maturity, 12 breadth, 13 conviction, 14 watchlist
  var R = { rank: 0, slug: 1, name: 2, cat: 3, chains: 4, tvl: 5, chg: 6, age: 7, imp: 8, mult: 9, mom: 10, mat: 11, brd: 12, conv: 13, watch: 14 };
  // Live row fields: 0 slug, 1 name, 2 category, 3 chains, 4 tvl, 5 mcap, 6 change_7d

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    tab: params.get('tab') || 'board',
    sort: 'imp',
    dir: -1,
  };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- the farm plan, regenerated from the row's own record ------------------------------
  // The same derivation lib/model.ts runs for board.json: category family, TVL-tier capital,
  // age-tier hold. The drawer's plan and the board file's plan are one plan, not two.
  function chainOf(row) { return row[R.chains].length > 0 ? row[R.chains][0] : 'its main chain'; }
  function secondChainOf(row) { return row[R.chains].length > 1 ? row[R.chains][1] : chainOf(row); }
  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    if (tvl >= 1e7) return 75;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function familyOf(cat) {
    var c = (cat || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'lending';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity') >= 0) return 'dex';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'staking';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'derivatives';
    if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('farm') >= 0) return 'yield';
    if (c.indexOf('stable') >= 0 || c.indexOf('rwa') >= 0) return 'stable';
    return 'generic';
  }
  function coreAction(row, family, capital) {
    var chain = chainOf(row);
    var name = row[R.name];
    switch (family) {
      case 'lending': return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' as the base position and leave it earning.';
      case 'dex': return 'Add $' + capital + ' of liquidity to the busiest USDC pair on ' + name + ' (' + chain + ') and keep the LP position in the wallet.';
      case 'bridge': return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + secondChainOf(row) + ' and make one transaction on the far side the same day.';
      case 'staking': return 'Stake $' + capital + " worth of the chain's staking asset through " + name + ' and hold the receipt token in the same wallet.';
      case 'derivatives': return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and run one small hedged position for at least a day.';
      case 'yield': return 'Deposit $' + capital + ' of USDC into the highest-TVL ' + name + ' vault on ' + chain + ' and keep the vault shares untouched.';
      case 'stable': return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the wallet.';
      default: return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' through its official app and leave the position open.';
    }
  }
  function secondAction(row, family) {
    var name = row[R.name];
    switch (family) {
      case 'lending': return { text: 'Borrow a small amount against the position (under 40% of its value) and repay it a week later, so the wallet shows both sides of the market.', cost: 'about $3 of gas across the two transactions', time: '10 minutes, twice' };
      case 'dex': return { text: "Make two swaps through " + name + "'s interface on different days, each above $25, so the wallet reads as a user and not a script.", cost: 'about $3 of gas and swap fees', time: '10 minutes, twice' };
      case 'bridge': return { text: 'Bridge a smaller amount ($25 or more) back through ' + name + ' a week later, so the wallet has traffic in both directions.', cost: 'about $4 of gas and bridge fees', time: '15 minutes' };
      case 'staking': return { text: 'Claim or compound the staking rewards once, so the wallet has a rewards interaction on record.', cost: 'about $2 of gas', time: '5 minutes' };
      case 'derivatives': return { text: 'Open and close one more small position in a later week, keeping total volume modest and realistic.', cost: 'about $3 of fees and gas', time: '15 minutes' };
      case 'yield': return { text: 'Move about 10% of the deposit into a second ' + name + ' vault, so the wallet uses more than one product.', cost: 'about $3 of gas', time: '10 minutes' };
      case 'stable': return { text: 'Use the stable asset once inside the same app (a swap or a deposit) rather than only holding it idle.', cost: 'about $2 of gas', time: '10 minutes' };
      default: return { text: 'Use a second feature of ' + name + ' once (a swap, a vote or a settings change) so the wallet is more than a single deposit.', cost: 'about $2 of gas', time: '10 minutes' };
    }
  }
  function farmPlan(row) {
    var capital = capitalFor(row[R.tvl]);
    var hold = holdDaysFor(row[R.age]);
    var family = familyOf(row[R.cat]);
    var name = row[R.name];
    return [
      { text: 'Open a dedicated farming wallet for ' + name + ' and fund it only with what this plan uses; keep the recovery phrase offline.', cost: 'about $2 in gas to fund', time: '5 minutes' },
      { text: coreAction(row, family, capital), cost: '$' + capital + ' of working capital plus roughly $' + (capital >= 150 ? 8 : 5) + ' of gas', time: '10-20 minutes' },
      secondAction(row, family),
      { text: 'Repeat one small qualifying action every week: a top-up, a swap, a vote or a claim check, always from the same wallet.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position at least ' + hold + ' days; points and airdrop snapshots favour wallets that stay across several weekly snapshots.', cost: 'the $' + capital + ' stays deployed, with normal market risk on it', time: hold + ' days' },
      { text: "Each week, open " + name + "'s own rewards or points page from the protocol's official site, save a screenshot of the balance, and log the wallet, dates and transaction hashes in a farm journal.", cost: 'nothing; never pay a third party to claim', time: '10 minutes a week' },
    ];
  }

  // ---- header, stats, controls -----------------------------------------------------------
  document.getElementById('model-version').textContent = D.model_version;
  document.getElementById('as-of').textContent =
    'Sealed snapshot: ' + D.source + ', as of ' + D.as_of + '. Rendered offline from that file alone — no live prices, no network.';

  var statsEl = document.getElementById('stats');
  var totalImplied = D.rows.reduce(function (n, r) { return n + r[R.imp]; }, 0);
  var top = D.rows[0];
  statsEl.innerHTML =
    stat('Watchlist covered', D.watchlist_size + ' / ' + D.watchlist_size, 'every slug above the ' + fmtUsd(D.floor_usd) + ' floor', true) +
    stat('Board rows', String(D.board_size), D.early_size + ' early finds below the floor') +
    stat('Combined implied', fmtUsd(totalImplied), 'across the whole board') +
    stat('Trading, set aside', String(D.live_size), 'already have tokens — never ranked') +
    stat('Strongest row', top ? esc(top[R.name]) : '—', top ? fmtUsd(top[R.imp]) + ' implied' : '');
  function stat(k, v, s, amber) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v' + (amber ? ' amber' : '') + '">' + v + '</div><div class="s">' + s + '</div></div>';
  }

  var cats = [];
  var chainCount = {};
  D.rows.forEach(function (r) {
    if (r[R.cat] && cats.indexOf(r[R.cat]) < 0) cats.push(r[R.cat]);
    r[R.chains].forEach(function (c) { chainCount[c] = (chainCount[c] || 0) + 1; });
  });
  cats.sort();
  var chainNames = Object.keys(chainCount).sort(function (a, b) { return chainCount[b] - chainCount[a]; });

  var controlsEl = document.getElementById('controls');
  controlsEl.innerHTML =
    '<input type="search" id="q" placeholder="Search name or slug…" value="' + esc(state.q) + '">' +
    '<label for="fcat">Category</label><select id="fcat"><option value="all">All categories</option>' +
    cats.map(function (c) { return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
    '<label for="fchain">Chain</label><select id="fchain"><option value="all">All chains</option>' +
    chainNames.map(function (c) { return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + ' (' + chainCount[c] + ')</option>'; }).join('') + '</select>' +
    '<label for="fsort">Sort</label><select id="fsort">' +
    [['imp', 'Implied value'], ['conv', 'Conviction'], ['tvl', 'TVL'], ['chg', '7d change'], ['age', 'Age'], ['name', 'Name']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
    '<div class="tabs" id="tabs">' +
    [['board', 'Full board'], ['watchlist', 'Watchlist'], ['early', 'Early'], ['live', 'Trading']]
      .map(function (t) { return '<button data-tab="' + t[0] + '"' + (state.tab === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div>';

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  document.getElementById('fcat').addEventListener('change', function (e) { state.category = e.target.value; render(); });
  document.getElementById('fchain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  document.getElementById('fsort').addEventListener('change', function (e) { state.sort = e.target.value; state.dir = e.target.value === 'name' ? 1 : -1; render(); });
  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    state.tab = b.getAttribute('data-tab');
    document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    render();
  });

  // ---- the table ---------------------------------------------------------------------------
  var tableEl = document.getElementById('board-table');
  var countEl = document.getElementById('count-line');

  function visibleRows() {
    var rows = D.rows.filter(function (r) {
      if (state.tab === 'watchlist' && r[R.watch] !== 1) return false;
      if (state.tab === 'early' && r[R.watch] !== 0) return false;
      if (state.category !== 'all' && r[R.cat] !== state.category) return false;
      if (state.chain !== 'all' && r[R.chains].indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r[R.name].toLowerCase().indexOf(q) < 0 && r[R.slug].indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = { imp: R.imp, conv: R.conv, tvl: R.tvl, chg: R.chg, age: R.age, name: R.name }[state.sort];
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return state.dir * av.localeCompare(bv);
      return state.dir * (av - bv);
    });
    return rows;
  }

  function render() {
    if (state.tab === 'live') { renderLive(); return; }
    var rows = visibleRows();
    var head =
      '<thead><tr><th>#</th><th>Protocol</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th>' +
      '<th class="num">Age</th><th class="num">Implied value</th><th class="num">× TVL</th><th class="num">Conviction</th></tr></thead>';
    var body = rows.map(function (r) {
      var chg = r[R.chg];
      return '<tr data-slug="' + esc(r[R.slug]) + '"' + (r[R.rank] <= 3 ? ' class="top3"' : '') + '>' +
        '<td class="rank">' + (r[R.rank] <= 3 ? '<b>' + r[R.rank] + '</b>' : r[R.rank]) + '</td>' +
        '<td><span class="pname">' + esc(r[R.name]) + '</span> ' +
        (r[R.watch] === 1 ? '<span class="tag tag-watch">Watchlist</span>' : '<span class="tag tag-early">Early</span>') +
        '<br><span class="pcat">' + esc(r[R.cat] || 'Uncategorised') + ' · ' + esc(r[R.slug]) + '</span></td>' +
        '<td class="chains">' + esc(r[R.chains].slice(0, 3).join(', ')) + (r[R.chains].length > 3 ? ' +' + (r[R.chains].length - 3) : '') + '</td>' +
        '<td class="num">' + fmtUsd(r[R.tvl]) + '</td>' +
        '<td class="num ' + (chg === null ? '' : chg >= 0 ? 'pos' : 'neg') + '">' + fmtPct(chg) + '</td>' +
        '<td class="num">' + fmtAge(r[R.age]) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r[R.imp]) + '</b></td>' +
        '<td class="num">' + (r[R.imp] / r[R.tvl]).toFixed(2) + '×</td>' +
        '<td class="num"><span class="conv"><span class="bar"><i style="width:' + r[R.conv] + '%"></i></span>' + r[R.conv] + '</span></td></tr>';
    }).join('');
    tableEl.innerHTML = head + '<tbody>' + body + '</tbody>';
    countEl.textContent = 'Showing ' + rows.length + ' of ' + D.board_size + ' board rows · click a row for its model working and farm plan';
    tableEl.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDrawer(tr.getAttribute('data-slug')); });
    });
  }

  function renderLive() {
    var head =
      '<thead><tr><th>Protocol</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th>' +
      '<th class="num">Market cap (the market’s own value)</th><th class="num">Mcap / TVL</th></tr></thead>';
    var body = D.live.map(function (r) {
      return '<tr><td><span class="pname">' + esc(r[1]) + '</span> <span class="tag tag-live">Trading</span>' +
        '<br><span class="pcat">' + esc(r[2] || 'Uncategorised') + ' · ' + esc(r[0]) + '</span></td>' +
        '<td class="chains">' + esc(r[3].slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r[4]) + '</td>' +
        '<td class="num ' + (r[6] === null ? '' : r[6] >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r[6]) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r[5]) + '</b></td>' +
        '<td class="num">' + (r[5] && r[4] ? (r[5] / r[4]).toFixed(2) + '×' : 'n/a') + '</td></tr>';
    }).join('');
    tableEl.innerHTML = head + '<tbody>' + body + '</tbody>';
    countEl.textContent = 'The ' + D.live_size + ' largest trading protocols in the snapshot. Their values are the market’s, not the model’s — this is the evidence the category multiples are learned from.';
  }

  // ---- the drawer ----------------------------------------------------------------------------
  var drawer = document.getElementById('drawer');
  var backdrop = document.getElementById('drawer-backdrop');
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r[R.slug]] = r; });
  var multByCat = {};
  D.multiples.forEach(function (m) { multByCat[m[0]] = m; });

  function closeDrawer() { drawer.hidden = true; backdrop.hidden = true; }
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  function openDrawer(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var base = r[R.tvl] * r[R.mult];
    var afterMom = base * r[R.mom];
    var afterMat = afterMom * r[R.mat];
    var cat = r[R.cat] || 'Uncategorised';
    var multRow = multByCat[cat];
    var samples = multRow ? multRow[3] : 0;
    var multipleNote = samples >= M.min_category_samples
      ? 'median of ' + samples + ' trading ' + cat + ' protocols in this snapshot'
      : 'the all-category median — fewer than ' + M.min_category_samples + ' trading ' + cat + ' peers to sample';
    var agePhrase = r[R.age] === null
      ? 'the index carries no listing date, so the model treats it as a one-year-old protocol'
      : 'it has been listed for ' + fmtAge(r[R.age]).replace(' yrs', ' years').replace(' days', ' days');
    var multiplePhrase = samples >= M.min_category_samples
      ? 'The market pays a median ' + r[R.mult].toFixed(2) + '× TVL for trading ' + cat + ' protocols, which sets the base; '
      : 'Too few ' + cat + ' protocols trade to sample (' + samples + '), so the all-category median of ' + r[R.mult].toFixed(2) + '× TVL sets the base; ';
    var why =
      r[R.name] + ' ranks #' + r[R.rank] + ' of ' + D.board_size + '. It holds ' + fmtUsd(r[R.tvl]) + ' of TVL across ' +
      (r[R.chains].length || 'an unlisted number of') + ' chain' + (r[R.chains].length === 1 ? '' : 's') +
      ' and records no token in the ' + D.as_of + ' snapshot' + (r[R.watch] === 1 ? ' — it sits on the watchlist, above the ' + fmtUsd(D.floor_usd) + ' floor.' : ' — an early find below the ' + fmtUsd(D.floor_usd) + ' floor.') +
      ' ' + multiplePhrase +
      agePhrase + ' (×' + r[R.mat].toFixed(2) + ' maturity), and its week (' + fmtPct(r[R.chg]) + ') applies ×' + r[R.mom].toFixed(2) + ' momentum.';
    var peers = D.live.filter(function (l) { return l[2] === r[R.cat]; }).slice(0, 3);
    var peerHtml = peers.length
      ? '<p class="peer">Trading peers in ' + esc(cat) + ': ' + peers.map(function (l) { return esc(l[1]) + ' (' + fmtUsd(l[5]) + ' mcap, ' + (l[5] / l[4]).toFixed(2) + '× TVL)'; }).join(' · ') + '.</p>'
      : '<p class="peer">No ' + esc(cat) + ' protocol appears in the snapshot’s top trading set; the multiple rests on the sampled protocols behind the method panel.</p>';
    var plan = farmPlan(r).map(function (s) {
      return '<li><b>' + esc(s.text) + '</b><span class="meta">Cost: ' + esc(s.cost) + ' · Time: ' + esc(s.time) + '</span></li>';
    }).join('');
    drawer.innerHTML =
      '<button class="close" id="drawer-close">Close ✕</button>' +
      '<h2>' + esc(r[R.name]) + '</h2>' +
      '<div class="sub">Rank #' + r[R.rank] + ' · ' + esc(cat) + ' · ' + esc(r[R.slug]) + ' · ' +
      (r[R.watch] === 1 ? '<span class="tag tag-watch">Watchlist</span>' : '<span class="tag tag-early">Early</span>') + ' records no token</div>' +
      '<div class="kv">' +
      cell('Implied value', fmtUsd(r[R.imp])) + cell('Conviction', r[R.conv] + ' / 100') +
      cell('TVL', fmtUsd(r[R.tvl])) + cell('Implied × TVL', (r[R.imp] / r[R.tvl]).toFixed(2) + '×') +
      cell('7d change', fmtPct(r[R.chg])) + cell('Age', fmtAge(r[R.age])) +
      '</div>' +
      '<h3>Why this rank</h3><p class="why">' + esc(why) + '</p>' +
      '<h3>The model’s working</h3>' +
      '<table class="breakdown">' +
      '<tr><td>TVL × category multiple (' + r[R.mult].toFixed(2) + '× — ' + esc(multipleNote) + ')</td><td class="num">' + fmtUsd(base) + '</td></tr>' +
      '<tr><td>× momentum (' + fmtPct(r[R.chg]) + ' week, weight ' + M.momentum_weight + ')</td><td class="num">×' + r[R.mom].toFixed(2) + ' → ' + fmtUsd(afterMom) + '</td></tr>' +
      '<tr><td>× maturity (' + fmtAge(r[R.age]) + ' token-less)</td><td class="num">×' + r[R.mat].toFixed(2) + ' → ' + fmtUsd(afterMat) + '</td></tr>' +
      '<tr><td>× breadth (' + r[R.chains].length + ' chains)</td><td class="num">×' + r[R.brd].toFixed(2) + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td class="num">' + fmtUsd(r[R.imp]) + '</td></tr></table>' +
      '<h3>Farm plan — if a token comes</h3><ol class="plan">' + plan + '</ol>' +
      '<h3>Evidence</h3>' + peerHtml +
      '<p class="peer">Plan costs are planning figures in USD, set from the protocol’s own TVL tier; they are not quotes. Farming is speculative: a protocol that records no token may never issue one.</p>';
    drawer.hidden = false;
    backdrop.hidden = false;
    document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  }
  function cell(k, v) { return '<div class="cell"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }

  // ---- method panel ---------------------------------------------------------------------------
  // Self-check: recompute every row's implied value from the figures on this page.
  var checked = 0;
  D.rows.forEach(function (r) {
    var again = Math.max(1, Math.round(r[R.tvl] * r[R.mult] * r[R.mom] * r[R.mat] * r[R.brd]));
    if (Math.abs(again - r[R.imp]) <= Math.max(2, r[R.imp] * 0.005)) checked++;
  });
  var multRows = D.multiples.map(function (m) {
    return '<tr><td>' + esc(m[0]) + '</td><td class="num">' + m[3] + '</td><td class="num">' + (m[2] === null ? 'n/a' : m[2].toFixed(3) + '×') + '</td><td class="num"><b>' + m[1].toFixed(3) + '×</b></td></tr>';
  }).join('');
  document.getElementById('method').innerHTML =
    '<h2>Method — the Compass model, in full</h2>' +
    '<p>Every figure below is computed from the sealed snapshot itself (' + D.source + ', ' + D.as_of + '); nothing is fetched and no protocol name is special-cased. Page self-check: <b>' + checked + ' of ' + D.board_size + '</b> board rows recompute from the figures printed here, within rounding.</p>' +
    '<h3>The formula</h3>' +
    '<p><code>implied = TVL × category_multiple × momentum × maturity × breadth</code>, rounded to whole dollars. ' +
    'The <b>category multiple</b> is the median market-cap-to-TVL of the snapshot’s trading protocols in the same category (only protocols with at least $1M TVL are sampled), clamped to [0.02×, 3×]; a category with fewer than ' + M.min_category_samples + ' trading peers falls back to the all-category median of ' + D.global_multiple.toFixed(3) + '×. ' +
    '<b>Momentum</b> is <code>1 + clamp(7d change, −40%, +80%) × 0.35</code>. <b>Maturity</b> is <code>0.75 + min(age, 1460 days)/1460 × 0.5</code>, with an unknown listing date treated as 365 days: the longer a protocol has operated without a token, the more of its eventual value the model credits today. ' +
    '<b>Breadth</b> adds 3% per extra chain beyond the first, up to six. <b>Conviction</b> (0–100) blends TVL scale (40), momentum (20), maturity (20), breadth (10) and category evidence (10).</p>' +
    '<h3>Who is on the board, and who is not</h3>' +
    '<p>The board carries the snapshot’s whole watchlist — all ' + D.watchlist_size + ' protocols above the ' + fmtUsd(D.floor_usd) + ' TVL floor that record no token — plus the ' + D.early_size + ' strongest rankable protocols below the floor. Exchanges, and versioned pools of another protocol (a name ending in a version marker), are never ranked. Protocols whose token already trades are set aside in the Trading view at the market’s own values; the board separates the two populations instead of mixing modelled and market prices.</p>' +
    '<h3>Category multiples learned from this snapshot</h3>' +
    '<div class="mult-table"><table><thead><tr><th>Category</th><th class="num">Trading sampled</th><th class="num">Raw median</th><th class="num">Applied</th></tr></thead><tbody>' + multRows + '</tbody></table></div>' +
    '<h3>Farm plans</h3>' +
    '<p>Each row’s plan is generated from its own record — category, chains, TVL, age — in six steps with a cost and a duration each: set up a dedicated wallet, take the category’s core position, add the interaction that makes the wallet read as a user, keep a weekly cadence, hold across several snapshots, and verify only on the protocol’s own rewards page. The plan printed in board.json and the plan in each drawer are generated by the same code.</p>';
  document.getElementById('foot').textContent =
    'Pre-Token Radar · model ' + D.model_version + ' · data: ' + D.source + ' snapshot of ' + D.as_of + ' (' + D.board_size + ' rows scored, ' + D.live_size + ' trading protocols set aside) · implied values are model estimates, not prices, and a protocol that records no token may never issue one.';

  render();
  var wanted = params.get('protocol');
  if (wanted && bySlug[wanted]) openDrawer(wanted);
})();
