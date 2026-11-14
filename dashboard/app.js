// Pre-Token Radar dashboard — renders window.TOKEN_RADAR (written by main.ts
// into data.js beside this page). No network: every figure comes from that
// object. The drawer re-derives each protocol's farm plan from the row's own
// fields, with the same derivation the model runs in lib/model.ts:
//   capital tier by TVL ($50 under $50M, $75 to $100M, $100 to $500M,
//   $150 to $1B, $250 above it); hold window by age (30 days under a year,
//   45 days to two years, 60 days above that); core action by category
//   family. So the drawer and board.json always agree.

(function () {
  var DATA = window.TOKEN_RADAR;
  if (!DATA) {
    document.getElementById("rows").innerHTML =
      '<tr><td colspan="9">No board data found — run main.ts to write data.js.</td></tr>';
    return;
  }
  var rows = DATA.rows;
  var trading = DATA.trading;
  var meta = DATA.meta;

  var state = { tab: "full", q: "", category: "", chain: "", sort: "implied" };

  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function moneyFull(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function pct(v) {
    if (v === null || v === undefined) return "—";
    var cls = v > 0 ? "pos" : v < 0 ? "neg" : "";
    return '<span class="' + cls + '">' + (v > 0 ? "+" : "") + v.toFixed(1) + "%</span>";
  }
  function ageLabel(days) {
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return days + "d";
  }

  // --- farm plan, same derivation as lib/model.ts -------------------------
  function capitalTier(tvl) {
    if (tvl >= 1e9) return 250;
    if (tvl >= 5e8) return 150;
    if (tvl >= 1e8) return 100;
    if (tvl >= 5e7) return 75;
    return 50;
  }
  function holdTier(ageDays) {
    if (ageDays >= 730) return 60;
    if (ageDays >= 365) return 45;
    return 30;
  }
  function familyAction(category) {
    switch (category) {
      case "Lending": case "CDP": case "Collateral Management":
        return "supply a major asset to its lending market and borrow a small amount against it";
      case "Dexs": case "Liquidity Manager":
        return "swap a small amount through its pools and add liquidity to the deepest core pair";
      case "Yield": case "Yield Aggregator": case "Farm": case "Leveraged Farming":
        return "deposit into its yield vault or farm and let the position compound";
      case "Bridge": case "Cross Chain Bridge": case "Canonical Bridge":
        return "bridge a small amount between chains through its own bridge";
      case "Liquid Staking": case "Liquid Restaking": case "Restaking": case "Restaked BTC":
        return "stake assets through it and hold the liquid receipt token";
      case "Derivatives": case "Options": case "Basis Trading": case "Prediction Market": case "DOR":
        return "open a small, defined-risk trading position and cap the downside before entering";
      case "RWA": case "Indexes": case "Onchain Capital Allocator":
        return "buy a small allocation of its tokenised product";
      case "Risk Curators": case "Governance Incentives":
        return "deposit into its curated vault and vote on the proposals that steer it";
      default:
        return "use its main product with a small first position and learn its flows";
    }
  }
  function farmSteps(row) {
    var capital = capitalTier(row.tvl_usd);
    var hold = holdTier(row.age_days);
    var action = familyAction(row.category);
    var firstChain = row.chains[0] || "its home chain";
    var secondChain = row.chains.length > 1 ? row.chains[1] : null;
    var categoryLabel = row.category || "uncategorised";
    var widen = secondChain
      ? "Repeat the same position on " + secondChain + " with about $" + Math.round(capital / 2) +
        " so your activity shows on two chains, and compare the gas cost per step before adding more."
      : "After a week, add a second, smaller deposit of about $" + Math.round(capital / 2) +
        " from the reserve you kept back, so the position grows in two on-chain touches instead of one.";
    return [
      "Open " + row.name + " on " + firstChain + " and confirm it is the real protocol: match its name and " +
        categoryLabel + " category against the DefiLlama record before you connect a wallet or move any funds.",
      "Start with about $" + capital + " in total and " + action + " on " + firstChain +
        "; keep roughly a third of the budget aside for gas and a follow-up deposit instead of committing it all at once.",
      widen,
      "Check the position once a week and write down every deposit, reward and point balance in a simple log, " +
        "so you can prove the activity later if the protocol asks for it.",
      "Hold the position for at least " + hold + " days and only exit early if the protocol pauses, the TVL drops " +
        "sharply for two weeks running, or a token launch is announced with a snapshot you have already passed.",
      "Stay safe: never share a seed phrase, revoke token approvals you no longer use, and only trust a token launch " +
        "announced on " + row.name + "'s own channels — a fake airdrop link costs more than the position is worth.",
    ];
  }

  // --- stats ---------------------------------------------------------------
  document.getElementById("fact-asof").textContent = meta.as_of;
  document.getElementById("stats").innerHTML =
    '<div class="stat"><span>Watchlist covered</span><strong>' + meta.watchlist_rows + " / " + meta.watchlist_rows +
    '</strong><small>every protocol on the snapshot watchlist</small></div>' +
    '<div class="stat"><span>Board rows</span><strong>' + meta.total_rows +
    '</strong><small>' + meta.early_rows + ' early finds below the $50M floor</small></div>' +
    '<div class="stat"><span>Combined implied value</span><strong>' + money(meta.total_implied_usd) +
    '</strong><small>sum of all ' + meta.total_rows + ' ranked rows</small></div>' +
    '<div class="stat"><span>Already trading — set aside</span><strong>' + meta.trading_rows +
    '</strong><small>largest tokens by market cap, not ranked</small></div>';

  // --- filter options --------------------------------------------------------
  var categories = [];
  rows.forEach(function (r) { if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category); });
  categories.sort();
  var chains = [];
  rows.concat(trading).forEach(function (r) {
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  chains.sort();
  document.getElementById("category").innerHTML =
    '<option value="">All categories</option>' +
    categories.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join("");
  document.getElementById("chain").innerHTML =
    '<option value="">All chains</option>' +
    chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join("");

  // --- table -----------------------------------------------------------------
  function visibleRows() {
    var list = state.tab === "trading" ? trading.slice() : rows.slice();
    if (state.tab === "watchlist") list = list.filter(function (r) { return r.is_watchlist; });
    if (state.tab === "early") list = list.filter(function (r) { return !r.is_watchlist; });
    if (state.q) {
      var q = state.q.toLowerCase();
      list = list.filter(function (r) {
        return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.toLowerCase().indexOf(q) >= 0;
      });
    }
    if (state.category) list = list.filter(function (r) { return r.category === state.category; });
    if (state.chain) list = list.filter(function (r) { return (r.chains || []).indexOf(state.chain) >= 0; });
    var sorters = {
      implied: function (a, b) { return (b.implied_value_usd || 0) - (a.implied_value_usd || 0); },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      conviction: function (a, b) { return (b.conviction || 0) - (a.conviction || 0); },
      multiple: function (a, b) { return (b.multiple || b.mcap_tvl_ratio || 0) - (a.multiple || a.mcap_tvl_ratio || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; },
    };
    list.sort(sorters[state.sort] || sorters.implied);
    return list;
  }

  function render() {
    var list = visibleRows();
    var body = document.getElementById("rows");
    if (state.tab === "trading") {
      body.innerHTML = list.map(function (r) {
        return "<tr data-slug=\"" + esc(r.slug) + "\"><td class=\"num\">—</td>" +
          "<td><span class=\"name\">" + esc(r.name) + "</span><br><span class=\"slug\">" + esc(r.slug) +
          "</span> <span class=\"cat\">" + esc(r.category || "—") + "</span></td>" +
          "<td class=\"num\">" + money(r.tvl_usd) + "</td>" +
          "<td class=\"num\">" + money(r.mcap_usd) + " mcap</td>" +
          "<td class=\"num\">" + r.mcap_tvl_ratio.toFixed(3) + "×</td>" +
          "<td>—</td><td class=\"num\">—</td><td class=\"num\">—</td>" +
          "<td>" + esc((r.chains || []).slice(0, 3).join(", ")) + "</td></tr>";
      }).join("");
    } else {
      body.innerHTML = list.map(function (r) {
        return "<tr data-slug=\"" + esc(r.slug) + "\"><td class=\"num\">" + r.rank + "</td>" +
          "<td><span class=\"name\">" + esc(r.name) + "</span>" +
          (r.is_watchlist ? '<span class="badge">WATCHLIST</span>' : "") +
          "<br><span class=\"slug\">" + esc(r.slug) + "</span> <span class=\"cat\">" +
          esc(r.category || "—") + "</span></td>" +
          "<td class=\"num\">" + money(r.tvl_usd) + "</td>" +
          "<td class=\"num\">" + money(r.implied_value_usd) + "</td>" +
          "<td class=\"num\">" + r.multiple.toFixed(3) + "×</td>" +
          "<td><span class=\"bar\"><i style=\"width:" + r.conviction + "%\"></i></span>" + r.conviction + "</td>" +
          "<td class=\"num\">" + pct(r.change_7d) + "</td>" +
          "<td class=\"num\">" + ageLabel(r.age_days) + "</td>" +
          "<td>" + esc((r.chains || []).slice(0, 3).join(", ")) + "</td></tr>";
      }).join("");
    }
    document.getElementById("count").textContent =
      list.length + " protocol" + (list.length === 1 ? "" : "s") + " shown";
    document.querySelectorAll("#tabs button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === state.tab);
    });
  }

  // --- drawer ------------------------------------------------------------------
  function openDrawer(slug) {
    var row = rows.filter(function (r) { return r.slug === slug; })[0];
    var drawer = document.getElementById("drawer");
    var body = document.getElementById("drawer-body");
    if (!row) {
      var t = trading.filter(function (r) { return r.slug === slug; })[0];
      if (!t) return;
      body.innerHTML = "<h2>" + esc(t.name) + "</h2><p class=\"slug\">" + esc(t.slug) + " · " +
        esc(t.category || "—") + "</p><p>This protocol already has a token trading, so Compass does not rank it. " +
        "Its market cap is " + moneyFull(t.mcap_usd) + " against " + moneyFull(t.tvl_usd) + " of TVL — a ratio of " +
        t.mcap_tvl_ratio.toFixed(3) + "×, one of the figures the category multiples are built from.</p>";
      drawer.hidden = false;
      return;
    }
    var peers = trading
      .filter(function (t) { return t.category === row.category; })
      .sort(function (a, b) { return b.mcap_usd - a.mcap_usd; })
      .slice(0, 5);
    var why = "Rank #" + row.rank + " because " + money(row.tvl_usd) + " of TVL at a " +
      row.multiple.toFixed(3) + "× " + (row.category || "category") + " multiple, " +
      "adjusted by momentum " + row.momentum.toFixed(3) + ", maturity " + row.maturity.toFixed(3) +
      " and breadth " + row.breadth.toFixed(3) + ", gives " + moneyFull(row.implied_value_usd) +
      " of implied value. Conviction " + row.conviction + "/100.";
    body.innerHTML =
      "<h2>" + esc(row.name) + "</h2><p class=\"slug\">" + esc(row.slug) + " · " + esc(row.category || "—") +
      (row.is_watchlist ? ' <span class="badge">WATCHLIST</span>' : "") + "</p>" +
      "<p>" + esc(why) + "</p>" +
      '<div class="kv">' +
      "<div><span>Rank</span><strong>#" + row.rank + "</strong></div>" +
      "<div><span>Implied value</span><strong>" + money(row.implied_value_usd) + "</strong></div>" +
      "<div><span>TVL</span><strong>" + money(row.tvl_usd) + "</strong></div>" +
      "<div><span>Multiple</span><strong>" + row.multiple.toFixed(3) + "×</strong></div>" +
      "<div><span>Conviction</span><strong>" + row.conviction + " / 100</strong></div>" +
      "<div><span>7-day TVL change</span><strong>" + (row.change_7d === null ? "—" : (row.change_7d > 0 ? "+" : "") + row.change_7d.toFixed(1) + "%") + "</strong></div>" +
      "<div><span>Age</span><strong>" + ageLabel(row.age_days) + "</strong></div>" +
      "<div><span>Chains</span><strong>" + row.chains.length + "</strong></div>" +
      "</div>" +
      "<h3>How the number is built</h3>" +
      '<table class="working"><tbody>' +
      "<tr><td>TVL</td><td class=\"num\">" + moneyFull(row.tvl_usd) + "</td></tr>" +
      "<tr><td>Category multiple (" + esc(row.category || "—") + ")</td><td class=\"num\">× " + row.multiple.toFixed(4) + "</td></tr>" +
      "<tr><td>Momentum</td><td class=\"num\">× " + row.momentum.toFixed(4) + "</td></tr>" +
      "<tr><td>Maturity</td><td class=\"num\">× " + row.maturity.toFixed(4) + "</td></tr>" +
      "<tr><td>Breadth (" + row.chains.length + " chain" + (row.chains.length === 1 ? "" : "s") + ")</td><td class=\"num\">× " + row.breadth.toFixed(4) + "</td></tr>" +
      "<tr><td><strong>Implied value</strong></td><td class=\"num\"><strong>" + moneyFull(row.implied_value_usd) + "</strong></td></tr>" +
      "</tbody></table>" +
      "<h3>How to farm it</h3><ol class=\"steps\">" +
      farmSteps(row).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
      "</ol>" +
      (peers.length ? "<h3>Trading peers in " + esc(row.category || "—") + "</h3>" +
        '<table class="peers"><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' +
        peers.map(function (p) {
          return "<tr><td>" + esc(p.name) + "</td><td class=\"num\">" + money(p.mcap_usd) +
            "</td><td class=\"num\">" + p.mcap_tvl_ratio.toFixed(3) + "×</td></tr>";
        }).join("") + "</tbody></table>" : "");
    drawer.hidden = false;
  }
  document.getElementById("drawer-close").addEventListener("click", function () {
    document.getElementById("drawer").hidden = true;
  });
  document.getElementById("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-slug]");
    if (tr) openDrawer(tr.getAttribute("data-slug"));
  });

  // --- method panel + self-check ----------------------------------------------
  document.getElementById("multiples").innerHTML =
    DATA.multiples.map(function (m) {
      return "<tr><td>" + esc(m.category) + "</td><td class=\"num\">" + m.multiple.toFixed(3) +
        "×</td><td class=\"num\">" + m.samples + "</td></tr>";
    }).join("") +
    "<tr><td><strong>Global fallback</strong></td><td class=\"num\"><strong>" +
    DATA.globalMultiple.toFixed(3) + "×</strong></td><td class=\"num\">—</td></tr>";
  var checked = 0, mismatched = 0;
  rows.forEach(function (r) {
    var recomputed = Math.max(1, Math.round(r.tvl_usd * r.multiple * r.momentum * r.maturity * r.breadth));
    if (recomputed === r.implied_value_usd) checked++; else mismatched++;
  });
  document.getElementById("selfcheck").textContent =
    "Self-check: " + checked + "/" + rows.length + " rows recompute exactly from the figures on this page" +
    (mismatched ? " (" + mismatched + " mismatch)" : " — the board and the model agree.");

  // --- controls -----------------------------------------------------------------
  document.getElementById("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]");
    if (!b) return;
    state.tab = b.getAttribute("data-tab");
    render();
  });
  document.getElementById("search").addEventListener("input", function (e) { state.q = e.target.value; render(); });
  document.getElementById("category").addEventListener("change", function (e) { state.category = e.target.value; render(); });
  document.getElementById("chain").addEventListener("change", function (e) { state.chain = e.target.value; render(); });
  document.getElementById("sort").addEventListener("change", function (e) { state.sort = e.target.value; render(); });
  document.getElementById("method-btn").addEventListener("click", function () {
    var m = document.getElementById("method");
    m.hidden = !m.hidden;
    if (!m.hidden) m.scrollIntoView();
  });

  // --- deep links: ?protocol=<slug> opens the drawer, ?category=<name> filters
  var params = new URLSearchParams(window.location.search);
  var cat = params.get("category");
  if (cat) {
    state.category = cat;
    document.getElementById("category").value = cat;
  }
  render();
  var proto = params.get("protocol");
  if (proto) openDrawer(proto);
})();
