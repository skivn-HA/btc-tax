"use strict";

const STORAGE = "btc-tax-calc-v1";
const PRICE_KEY = "btc-tax-calc-price";

const form = document.getElementById("calc");
const resultsEl = document.getElementById("results");
const priceValue = document.getElementById("priceValue");
const priceChange = document.getElementById("priceChange");
const priceMeta = document.getElementById("priceMeta");
const livePriceChoice = document.getElementById("livePriceChoice");
const installBtn = document.getElementById("installBtn");
const fileBanner = document.getElementById("fileBanner");
const salePreview = document.getElementById("salePreview");
const holdingReadout = document.getElementById("holdingReadout");
const ratesBody = document.getElementById("ratesBody");

const parcelRows = document.getElementById("parcelRows");
const parcelSummary = document.getElementById("parcelSummary");
const saveStatus = document.getElementById("saveStatus");
const FILE_APP = "au-btc-tax-calculator";
const android = window.AndroidBridge || null;

const state = {
  price: null,
  priceError: "",
  deferredPrompt: null,
  loadingPrice: false,
  purchases: [],
};

function withCommas(value) {
  const raw = String(value ?? "").replace(/[^0-9.\-]/g, "");
  if (!raw) return "";
  const negative = raw.startsWith("-");
  const body = raw.replace(/-/g, "");
  const dot = body.indexOf(".");
  const whole = (dot >= 0 ? body.slice(0, dot) : body).replace(/^0+(?=\d)/, "");
  const decimals = dot >= 0 ? "." + body.slice(dot + 1).replace(/\./g, "") : "";
  return (negative ? "-" : "") + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + decimals;
}

function formatNumberInput(input) {
  const old = input.value;
  const next = withCommas(old);
  if (next === old) return;
  const caret = input.selectionStart ?? old.length;
  const keep = old.slice(0, caret).replace(/[^0-9.\-]/g, "").length;
  input.value = next;
  let pos = 0;
  let seen = 0;
  while (pos < next.length && seen < keep) {
    if (/[0-9.\-]/.test(next[pos])) seen += 1;
    pos += 1;
  }
  if (document.activeElement === input) input.setSelectionRange(pos, pos);
}

function formatAllNumbers() {
  for (const input of form.querySelectorAll('input[inputmode="decimal"]')) {
    const next = withCommas(input.value);
    if (next !== input.value) input.value = next;
  }
}

function blankPurchase() {
  return { date: "", btc: "", cost: "", sold: "", note: "" };
}

function cleanPurchases(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row) => ({
    date: String((row && row.date) || ""),
    btc: String((row && row.btc) ?? ""),
    cost: String((row && row.cost) ?? ""),
    sold: String((row && row.sold) ?? ""),
    note: String((row && row.note) || ""),
  }));
}

function renderParcelRows() {
  if (!state.purchases.length) {
    parcelRows.innerHTML = `<tr class="empty"><td colspan="7">No purchases yet. Click <strong>Add purchase</strong> for each time you bought bitcoin.</td></tr>`;
  } else {
    parcelRows.innerHTML = state.purchases.map((row, i) => `<tr data-index="${i}">
      <td class="num">${i + 1}</td>
      <td class="date-cell" data-label="Date bought"><input type="date" data-field="date" value="${esc(row.date)}" aria-label="Purchase ${i + 1} date bought"></td>
      <td data-label="BTC bought"><input data-field="btc" inputmode="decimal" placeholder="0.00" value="${esc(withCommas(row.btc))}" aria-label="Purchase ${i + 1} bitcoin bought"></td>
      <td data-label="Cost (AUD)"><input data-field="cost" inputmode="decimal" placeholder="$0.00" value="${esc(withCommas(row.cost))}" aria-label="Purchase ${i + 1} total cost in AUD"></td>
      <td data-label="Already sold"><input data-field="sold" inputmode="decimal" placeholder="0" value="${esc(withCommas(row.sold))}" aria-label="Purchase ${i + 1} bitcoin already sold"></td>
      <td data-label="Note"><input data-field="note" maxlength="60" placeholder="Exchange" value="${esc(row.note)}" aria-label="Purchase ${i + 1} note"></td>
      <td class="remove-cell"><button type="button" class="remove" data-remove="${i}" aria-label="Remove purchase ${i + 1}" title="Remove">×</button></td>
    </tr>`).join("");
  }
  updateParcelSummary();
}

function updateParcelSummary() {
  const toNum = (v) => {
    const n = parseFloat(String(v || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  let bought = 0;
  let sold = 0;
  let cost = 0;
  let count = 0;
  for (const row of state.purchases) {
    const b = toNum(row.btc);
    if (!b) continue;
    count += 1;
    bought += b;
    sold += Math.min(b, toNum(row.sold));
    cost += toNum(row.cost);
  }
  if (!count) {
    parcelSummary.textContent = "";
    return;
  }
  const held = Math.max(0, bought - sold);
  parcelSummary.textContent =
    count + (count === 1 ? " purchase" : " purchases") + " · " +
    formatBTC(bought) + " bought for " + BtcTax.formatAUD(cost) + " · " +
    formatBTC(held) + " still held.";
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function todayISO() {
  const now = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return now.getFullYear() + "-" + z(now.getMonth() + 1) + "-" + z(now.getDate());
}

function yearsAgoISO(years) {
  const now = new Date();
  now.setFullYear(now.getFullYear() - years);
  const z = (n) => String(n).padStart(2, "0");
  return now.getFullYear() + "-" + z(now.getMonth() + 1) + "-" + z(now.getDate());
}

function formatBTC(amount) {
  if (!(amount > 0)) return "0 BTC";
  const digits = amount >= 1 ? 4 : amount >= 0.01 ? 5 : 8;
  return amount.toLocaleString("en-AU", { maximumFractionDigits: digits }) + " BTC";
}

function formatPct(rate, digits) {
  const pct = rate * 100;
  const places = digits == null ? (Number.isInteger(Math.round(pct * 100) / 100) && pct % 1 === 0 ? 0 : 2) : digits;
  return pct.toLocaleString("en-AU", { minimumFractionDigits: places, maximumFractionDigits: places }) + "%";
}

function rateColor(rate) {
  if (rate <= 0) return "#5c6778";
  if (rate < 0.2) return "#6aa6ff";
  if (rate <= 0.3) return "#f7931a";
  if (rate <= 0.37) return "#e07a45";
  return "#e15b64";
}

function fieldValue(name) {
  const field = form.elements[name];
  if (!field) return "";
  if (typeof RadioNodeList !== "undefined" && field instanceof RadioNodeList) return field.value;
  if (field.length && field[0] && field[0].type === "radio") return field.value;
  if (field.type === "checkbox") return field.checked;
  return field.value;
}

function readInput() {
  const family = !!fieldValue("family");
  const hasHelp = !!fieldValue("hasHelp");
  const priceChoice = fieldValue("priceChoice");
  const market = state.price ? state.price.aud : 0;
  return {
    name: String(fieldValue("name") || "").trim(),
    year: fieldValue("year"),
    resident: fieldValue("residency") === "resident",
    paye: fieldValue("paye"),
    otherIncome: fieldValue("otherIncome"),
    deductions: fieldValue("deductions"),
    withheld: fieldValue("withheld"),
    btc: fieldValue("btc"),
    priceAud: priceChoice === "custom" ? fieldValue("customPrice") : market,
    priceIsCustom: priceChoice === "custom",
    sellFees: fieldValue("profitChoice") !== "profit" ? fieldValue("sellFees") : 0,
    profitMode: fieldValue("profitChoice"),
    purchases: state.purchases,
    method: fieldValue("method"),
    costBase: fieldValue("costBase"),
    knownProfit: fieldValue("knownProfit"),
    holding: fieldValue("holding"),
    acquired: fieldValue("acquired"),
    disposed: fieldValue("disposed"),
    capitalLosses: fieldValue("capitalLosses"),
    medicareExempt: fieldValue("medicareExempt"),
    privateHospital: fieldValue("privateHospital"),
    family,
    spouseIncome: family ? fieldValue("spouseIncome") : 0,
    dependants: family ? fieldValue("dependants") : 0,
    hasHelp,
    helpBalance: hasHelp ? fieldValue("helpBalance") : 0,
    helpExtra: hasHelp ? fieldValue("helpExtra") : 0,
  };
}

function syncVisibility() {
  document.getElementById("customPriceWrap").hidden = fieldValue("priceChoice") !== "custom";
  const mode = fieldValue("profitChoice");
  document.getElementById("feeFields").hidden = mode === "profit";
  document.getElementById("costBaseWrap").hidden = mode !== "cost";
  document.getElementById("parcelFields").hidden = mode !== "parcels";
  document.getElementById("profitFields").hidden = mode !== "profit";
  document.getElementById("holdingChoice").hidden = mode === "parcels";
  document.getElementById("acquiredWrap").hidden = mode === "parcels";
  document.getElementById("parcelHoldingHint").hidden = mode !== "parcels";
  document.getElementById("familyFields").hidden = !fieldValue("family");
  document.getElementById("helpFields").hidden = !fieldValue("hasHelp");
}

function moneyCell(amount) {
  return BtcTax.formatAUD(amount);
}

function renderHero(result, name) {
  const who = name ? "Estimate for " + esc(name) + " · " + esc(result.yearLabel) : esc(result.yearLabel);
  if (result.needsBitcoin || result.needsPrice) {
    return `<div class="hero wait"><p class="kicker">This sale</p><p class="hero-amount">—</p><p class="who">${who}</p><p class="story">${esc(result.story)}</p></div>`;
  }
  const zero = result.extra.tax <= 0;
  const kicker = zero ? "No tax payable on this sale" : "Tax payable on this sale";
  let extra = "";
  if (result.extra.help > 0) {
    extra = `<p class="story">Plus ${esc(BtcTax.formatAUD(result.extra.help))} of extra study-loan repayment. Cash to allow for both is ${esc(BtcTax.formatAUD(result.extra.cash))}.</p>`;
  }
  let stats = "";
  if (result.grossGain > 0) {
    stats = `<div class="stat-row">
      <div><span>Profit that is taxable</span><strong>${esc(BtcTax.formatAUD(result.netCapitalGain))}</strong></div>
      <div><span>Effective rate on the capital profit</span><strong>${esc(formatPct(result.effectiveOnProfit, 1))}</strong></div>
      <div><span>Rate on the taxable profit</span><strong>${esc(formatPct(result.effectiveOnTaxable, 1))}</strong></div>
    </div>`;
  } else if (result.grossGain < 0) {
    stats = `<div class="stat-row"><div><span>Capital loss to carry forward</span><strong>${esc(BtcTax.formatAUD(result.lossCarryForward))}</strong></div></div>`;
  }
  return `<div class="hero ${zero ? "zero" : ""}">
    <p class="kicker">${kicker}</p>
    <p class="hero-amount" id="taxPayable">${esc(BtcTax.formatAUD(result.extra.tax))}</p>
    <p class="who">${who}</p>
    ${stats}
    <p class="story">${esc(result.story)}</p>
    ${extra}
  </div>`;
}

function renderLists(result) {
  const warnings = result.warnings.length
    ? `<ul class="warnings">${result.warnings.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
    : "";
  const notes = result.notes.length
    ? `<ul class="notes">${result.notes.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
    : "";
  return warnings + notes;
}

function renderSetAside(result) {
  if (result.needsBitcoin || result.needsPrice || result.extra.cash <= 0 || !(result.price > 0)) return "";
  const btc = result.extra.cash / result.price;
  const what = result.extra.help > 0 ? "the tax and the extra study-loan repayment" : "the tax";
  return `<div class="set-aside">At this price, set aside <strong>${esc(formatBTC(btc))}</strong> (${esc(BtcTax.formatAUD(result.extra.cash))}) to cover ${what}.</div>`;
}

function renderSale(result) {
  if (result.needsBitcoin) return "";
  const rows = [];
  const add = (label, value, total) => rows.push(`<div class="${total ? "total" : ""}"><dt>${label}</dt><dd>${value}</dd></div>`);
  if (result.btc > 0) add("Bitcoin being sold", esc(formatBTC(result.btc)));
  if (result.price > 0) add("Sale price used", esc(BtcTax.formatAUD(result.price)));
  if (result.btc > 0 && result.price > 0) add("Sale proceeds", esc(BtcTax.formatAUD(result.proceeds)));
  if (result.sellFees > 0) add("Selling costs", esc(BtcTax.formatAUD(result.sellFees)));
  if (result.costBase != null && (result.profitMode !== "profit" || result.btc > 0)) {
    add(result.profitMode === "parcels" ? "Cost base from purchases" : "Cost base", esc(BtcTax.formatAUD(result.costBase)));
  }
  if (result.profitMode === "parcels") add("Bitcoin matched", esc(result.methodLabel));
  add("Capital profit", esc(BtcTax.formatAUD(result.grossGain)));
  if (result.lossesUsed > 0) add("Capital losses used", esc(BtcTax.formatAUD(result.lossesUsed)));
  add("Length of time held", esc(result.holdingLabel));
  const discountText = result.partialDiscount
    ? esc(BtcTax.formatAUD(result.discountAmount)) + " off (50% of the part held 12 months or more)"
    : result.discountApplies
      ? esc(BtcTax.formatAUD(result.discountAmount)) + " off (50%)"
      : "None";
  add("CGT discount", discountText);
  add("Profit that is taxable", esc(BtcTax.formatAUD(result.netCapitalGain)), true);
  if (result.lossCarryForward > 0) add("Loss still to carry forward", esc(BtcTax.formatAUD(result.lossCarryForward)));
  return `<h3>How the profit is taxed</h3><dl class="breakdown">${rows.join("")}</dl>`;
}

function prettyDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return "";
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    .toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function renderLots(result) {
  if (!result.lots || !result.lots.length || result.needsBitcoin || result.needsPrice) return "";
  const rows = result.lots.map((lot) => {
    const title = lot.unmatched
      ? "No matching purchase"
      : "#" + lot.row + " · " + prettyDate(lot.date);
    const sub = lot.unmatched ? "Treated as a $0 cost base" : [lot.note, "Held " + lot.heldLabel].filter(Boolean).join(" · ");
    let tag;
    if (!result.resident) tag = `<span class="tag no">No discount</span>`;
    else if (lot.eligible) tag = `<span class="tag yes">50% discount</span>`;
    else if (lot.discountFromPretty) tag = `<span class="tag no">Discount from ${esc(lot.discountFromPretty)}</span>`;
    else tag = `<span class="tag no">No discount</span>`;
    return `<tr>
      <td>${esc(title)}<small>${esc(sub)}</small>${tag}</td>
      <td>${esc(formatBTC(lot.btc))}</td>
      <td>${esc(BtcTax.formatAUD(lot.cost))}</td>
      <td>${esc(BtcTax.formatAUD(lot.proceeds))}</td>
      <td>${esc(BtcTax.formatAUD(lot.gain))}</td>
    </tr>`;
  }).join("");
  return `<h3>Purchases used for this sale</h3>
    <table class="lots">
      <thead><tr><th>Purchase</th><th>Bitcoin</th><th>Cost base</th><th>Proceeds</th><th>Gain</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderWait(result) {
  if (!(result.discountSaving > 1)) return "";
  const when = result.waitUntilPretty
    ? " A sale on or after " + result.waitUntilPretty + " would qualify" + (result.profitMode === "parcels" ? " for all of these purchases." : ".")
    : "";
  let help = "";
  if (result.discountSavingHelp > 1) {
    help = " The extra study-loan repayment would also be " + BtcTax.formatAUD(result.discountSavingHelp) + " lower.";
  }
  const lead = result.partialDiscount ? "If all of it got the 50% discount." : "If the 50% discount applied.";
  return `<div class="callout"><strong>${lead}</strong> Tax on this same profit would be ${esc(BtcTax.formatAUD(result.taxIfDiscounted))} instead, which is ${esc(BtcTax.formatAUD(result.discountSaving))} less.${esc(when + help)}</div>`;
}

function renderTable(result) {
  const rows = [
    ["Taxable income", result.base.taxableIncome, result.next.taxableIncome, result.next.taxableIncome - result.base.taxableIncome],
    ["Income tax", result.base.incomeTax, result.next.incomeTax, result.extra.incomeTax],
    ["Medicare levy", result.base.medicare, result.next.medicare, result.extra.medicare],
    ["Medicare levy surcharge", result.base.mls, result.next.mls, result.extra.mls],
    ["Total tax", result.base.tax, result.next.tax, result.extra.tax],
  ];
  if (result.base.help > 0 || result.next.help > 0 || result.extra.help > 0) {
    rows.push(["Study-loan repayment", result.base.help, result.next.help, result.extra.help]);
  }
  const body = rows.map(([label, before, after, diff]) => `<tr>
    <th scope="row">${label}</th>
    <td>${esc(moneyCell(before))}</td>
    <td>${esc(moneyCell(after))}</td>
    <td class="diff">${esc(moneyCell(diff))}</td>
  </tr>`).join("");
  return `<h3>Tax for the whole year</h3>
    <table class="cmp">
      <thead><tr><th></th><th>Before this sale</th><th>After this sale</th><th>From this sale</th></tr></thead>
      <tbody>${body}</tbody>
      <caption>These are full-year amounts. Tax already taken from your pay is not subtracted unless you enter it above.</caption>
    </table>`;
}

function renderMarginal(result) {
  if (!(result.netCapitalGain > 0)) return "";
  const parts = [formatPct(result.marginalIncomeRate) + " income tax"];
  if (result.marginalMedicare === 0.1) parts.push("10% Medicare levy while the low-income reduction is phasing in");
  else if (result.marginalMedicare > 0) parts.push(formatPct(result.marginalMedicare) + " Medicare levy");
  if (result.base.mlsRate === result.next.mlsRate && result.next.mlsRate > 0) {
    parts.push(formatPct(result.next.mlsRate) + " Medicare levy surcharge");
  }
  const crossed = result.slices.length > 1 ? " This profit passes through more than one tax bracket." : "";
  return `<p class="hint">Last dollar of the taxable profit: ${esc(parts.join(" + "))}.${esc(crossed)}</p>`;
}

function renderSlices(result) {
  if (!result.slices.length) return "";
  const total = result.slices.reduce((sum, slice) => sum + slice.amount, 0) || 1;
  const bar = result.slices.map((slice) => {
    const width = Math.max(2, (slice.amount / total) * 100);
    return `<i style="width:${width}%;background:${rateColor(slice.rate)}"></i>`;
  }).join("");
  const key = result.slices.map((slice) => `<li><span><i class="swatch" style="background:${rateColor(slice.rate)}"></i>${esc(formatPct(slice.rate))}</span><span>${esc(BtcTax.formatAUD(slice.amount))} · tax ${esc(BtcTax.formatAUD(slice.tax))}</span></li>`).join("");
  return `<h3>Where the taxable profit sits</h3><div class="bar" aria-hidden="true">${bar}</div><ul class="slice-key">${key}</ul>${renderMarginal(result)}`;
}

function renderLodgement(result) {
  if (!result.lodgement) return "";
  const due = result.lodgement.due;
  const line = due > 0
    ? `Estimated amount payable when you lodge: ${BtcTax.formatAUD(due)}.`
    : due < 0
      ? `Estimated refund when you lodge: ${BtcTax.formatAUD(Math.abs(due))}.`
      : "Estimated balance when you lodge: $0.00.";
  return `<h3>When you lodge</h3><p>${esc(line)} This is income tax, Medicare, and any study-loan repayment, minus the ${esc(BtcTax.formatAUD(result.lodgement.withheld))} already withheld. It is the position for the whole year, after this sale.</p>`;
}

function render(result) {
  const name = String(fieldValue("name") || "").trim();
  resultsEl.innerHTML = [
    renderHero(result, name),
    renderLists(result),
    renderSetAside(result),
    renderSale(result),
    renderLots(result),
    renderWait(result),
    renderTable(result),
    renderSlices(result),
    renderLodgement(result),
  ].join("");
  document.title = name ? name + " · Bitcoin Tax" : "Australian Bitcoin Tax Calculator";
  updateReadouts(result);
  renderRates();
}

function updateReadouts(result) {
  if (result.btc > 0 && result.price > 0) {
    const costs = result.sellFees > 0 ? " after selling costs" : "";
    salePreview.textContent = formatBTC(result.btc) + " at " + BtcTax.formatAUD(result.price) + " is " + BtcTax.formatAUD(result.proceeds) + costs + ".";
  } else if (state.price && fieldValue("priceChoice") === "live") {
    salePreview.textContent = "Market price " + BtcTax.formatAUD(state.price.aud) + ". Enter the bitcoin you are selling.";
  } else {
    salePreview.textContent = "";
  }

  if (result.profitMode === "parcels") {
    holdingReadout.textContent = result.lots && result.lots.length
      ? "Bitcoin in this sale: " + result.holdingLabel.charAt(0).toLowerCase() + result.holdingLabel.slice(1) + "."
      : "Enter the sale date. If it is left blank, today is used.";
  } else if (result.dates && result.dates.invalid) {
    holdingReadout.textContent = "The sale date needs to be after the acquisition date.";
  } else if (result.dates && !result.dates.invalid) {
    const discount = result.dates.qualifies
      ? "The 50% discount is available on these dates."
      : "The 50% discount starts on " + result.dates.discountFromPretty + ".";
    holdingReadout.textContent = "Held for " + result.dates.label + ". " + discount;
  } else {
    holdingReadout.textContent = "Enter both dates to check the 12-month test. The buy date and the sale date are both excluded.";
  }
}

function renderRates() {
  const info = BtcTax.describeYear(fieldValue("year"), fieldValue("residency") === "resident");
  const rows = info.lines.map((line) => `<tr><td>${esc(line.range)}</td><td>${esc(line.rate)}</td><td>${esc(line.formula)}</td></tr>`).join("");
  const notes = info.notes.map((note) => `<li>${esc(note)}</li>`).join("");
  ratesBody.innerHTML = `<table class="rates-table"><tbody>${rows}</tbody></table><ul class="notes">${notes}</ul>`;
}

function renderTicker() {
  const price = state.price;
  if (!price) {
    priceValue.textContent = "—";
    priceChange.hidden = true;
    livePriceChoice.textContent = "Live market price";
    priceMeta.textContent = state.priceError || "Fetching the bitcoin price in AUD…";
    return;
  }
  priceValue.textContent = BtcTax.formatAUD(price.aud);
  livePriceChoice.textContent = "Live market price (" + BtcTax.formatAUD(price.aud) + ")";
  if (price.change == null || !Number.isFinite(price.change)) {
    priceChange.hidden = true;
  } else {
    const up = price.change >= 0;
    priceChange.hidden = false;
    priceChange.textContent = (up ? "+" : "−") + Math.abs(price.change).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "% today";
    priceChange.className = "change " + (up ? "up" : "down");
  }
  const when = new Date(price.updated).toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "numeric",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
  const source = price.cached ? "Last saved price · " + price.source : price.source;
  const problem = state.priceError ? state.priceError + " " : "";
  priceMeta.textContent = problem + source + " · " + when + " Sydney";
}

function summaryText(input, result) {
  const lines = [
    "Australian Bitcoin Tax Calculator",
    input.name ? "Estimate for " + input.name : "Estimate",
    "Financial year " + result.yearLabel,
    "",
  ];
  if (result.price > 0) lines.push("Sale price: " + BtcTax.formatAUD(result.price));
  if (result.btc > 0) lines.push("Bitcoin sold: " + formatBTC(result.btc));
  if (result.proceeds) lines.push("Sale proceeds: " + BtcTax.formatAUD(result.proceeds));
  if (result.profitMode !== "profit") lines.push("Cost base: " + BtcTax.formatAUD(result.costBase));
  if (result.lots && result.lots.length) {
    lines.push("Purchases used (" + result.methodLabel.toLowerCase() + "):");
    for (const lot of result.lots) {
      const label = lot.unmatched ? "No matching purchase" : "#" + lot.row + " " + prettyDate(lot.date);
      lines.push("  " + label + ": " + formatBTC(lot.btc) + ", cost " + BtcTax.formatAUD(lot.cost) + ", gain " + BtcTax.formatAUD(lot.gain) + (lot.eligible ? ", 50% discount" : ""));
    }
  }
  lines.push("Capital profit: " + BtcTax.formatAUD(result.grossGain));
  lines.push("CGT discount: " + (result.discountApplies ? BtcTax.formatAUD(result.discountAmount) : "none"));
  lines.push("Profit that is taxable: " + BtcTax.formatAUD(result.netCapitalGain));
  lines.push("Tax payable on this sale: " + BtcTax.formatAUD(result.extra.tax));
  lines.push("  Income tax: " + BtcTax.formatAUD(result.extra.incomeTax));
  lines.push("  Medicare levy: " + BtcTax.formatAUD(result.extra.medicare));
  lines.push("  Medicare levy surcharge: " + BtcTax.formatAUD(result.extra.mls));
  if (result.extra.help) lines.push("  Extra study-loan repayment: " + BtcTax.formatAUD(result.extra.help));
  lines.push("Taxable income after the sale: " + BtcTax.formatAUD(result.next.taxableIncome));
  lines.push("");
  lines.push(result.story);
  lines.push("");
  lines.push("Estimate only. Not tax advice, and not sent to the ATO.");
  return lines.join("\n");
}

function calculateNow() {
  const input = readInput();
  let result;
  try {
    result = BtcTax.calculate(input);
  } catch (error) {
    resultsEl.innerHTML = `<div class="hero wait"><p class="kicker">Something went wrong</p><p class="story">${esc(error.message)}</p></div>`;
    return null;
  }
  render(result);
  return { input, result };
}

function collectData() {
  const data = {};
  for (const field of form.elements) {
    if (!field.name) continue;
    if (field.type === "radio") {
      if (field.checked) data[field.name] = field.value;
    } else if (field.type === "checkbox") {
      data[field.name] = field.checked;
    } else {
      data[field.name] = field.value;
    }
  }
  data.purchases = cleanPurchases(state.purchases);
  return data;
}

function save() {
  localStorage.setItem(STORAGE, JSON.stringify(collectData()));
}

function restore() {
  const raw = localStorage.getItem(STORAGE);
  if (!raw) return false;
  let data;
  try { data = JSON.parse(raw); } catch (error) { return false; }
  applyData(data);
  return true;
}

function applyData(data) {
  state.purchases = cleanPurchases(data.purchases);
  for (const [key, value] of Object.entries(data)) {
    if (key === "purchases") continue;
    const field = form.elements[key];
    if (!field) continue;
    if ((typeof RadioNodeList !== "undefined" && field instanceof RadioNodeList) || (field.length && field[0] && field[0].type === "radio")) {
      for (const radio of field) radio.checked = radio.value === value;
    } else if (field.type === "checkbox") {
      field.checked = !!value;
    } else if ("value" in field) {
      field.value = value;
    }
  }
  formatAllNumbers();
  return true;
}

function setChecked(name, value) {
  const field = form.elements[name];
  if (!field) return;
  for (const radio of field) radio.checked = radio.value === value;
}

function monthsAgoISO(months) {
  const now = new Date();
  now.setMonth(now.getMonth() - months);
  const z = (n) => String(n).padStart(2, "0");
  return now.getFullYear() + "-" + z(now.getMonth() + 1) + "-" + z(now.getDate());
}

function loadExample() {
  const acquired = yearsAgoISO(2);
  state.purchases = [
    { date: monthsAgoISO(40), btc: "0.08", cost: "3200", sold: "", note: "First buy" },
    { date: monthsAgoISO(15), btc: "0.05", cost: "6500", sold: "", note: "" },
    { date: monthsAgoISO(3), btc: "0.04", cost: "6800", sold: "", note: "This year" },
  ];
  form.elements.method.value = "fifo";
  renderParcelRows();
  form.elements.name.value = "Alex";
  form.elements.year.value = "2026-27";
  form.elements.residency.value = "resident";
  form.elements.paye.value = "95000";
  form.elements.otherIncome.value = "";
  form.elements.deductions.value = "";
  form.elements.withheld.value = "22000";
  form.elements.btc.value = "0.15";
  form.elements.costBase.value = "4000";
  form.elements.knownProfit.value = "";
  form.elements.sellFees.value = "25";
  form.elements.acquired.value = acquired;
  form.elements.disposed.value = todayISO();
  form.elements.capitalLosses.value = "";
  form.elements.spouseIncome.value = "";
  form.elements.dependants.value = "";
  form.elements.helpBalance.value = "";
  form.elements.helpExtra.value = "";
  form.elements.medicareExempt.checked = false;
  form.elements.privateHospital.checked = true;
  form.elements.family.checked = false;
  form.elements.hasHelp.checked = false;
  setChecked("holding", "over12");
  setChecked("profitChoice", "parcels");
  if (state.price) {
    setChecked("priceChoice", "live");
    form.elements.customPrice.value = "";
  } else {
    setChecked("priceChoice", "custom");
    form.elements.customPrice.value = "100000";
  }
  formatAllNumbers();
  syncVisibility();
  save();
  calculateNow();
}

function resetForm() {
  form.reset();
  localStorage.removeItem(STORAGE);
  state.purchases = [];
  renderParcelRows();
  form.elements.disposed.value = todayISO();
  syncVisibility();
  save();
  calculateNow();
}

function fileName() {
  const name = String(fieldValue("name") || "").trim().replace(/[\\/:*?"<>|]+/g, "").slice(0, 40);
  return "Bitcoin tax" + (name ? " - " + name : "") + " - " + todayISO() + ".json";
}

function showSaveStatus(text) {
  saveStatus.textContent = text;
}

async function saveToFile() {
  const payload = {
    app: FILE_APP,
    version: 1,
    savedAt: new Date().toISOString(),
    data: collectData(),
  };
  const text = JSON.stringify(payload, null, 2);
  const suggestedName = fileName();
  if (android) {
    android.saveFile(suggestedName, text);
    return;
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "Bitcoin tax calculator file", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      showSaveStatus("Saved as " + handle.name + ".");
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showSaveStatus("Saved as " + suggestedName + " in your Downloads folder.");
}

function loadFileText(text, name) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    showSaveStatus(name + " is not a saved calculator file.");
    return;
  }
  const data = payload && payload.app === FILE_APP ? payload.data : null;
  if (!data || typeof data !== "object") {
    showSaveStatus(name + " is not a saved calculator file.");
    return;
  }
  form.reset();
  applyData(data);
  if (!form.elements.disposed.value) form.elements.disposed.value = todayISO();
  renderParcelRows();
  syncVisibility();
  save();
  calculateNow();
  const when = payload.savedAt
    ? " It was saved " + new Date(payload.savedAt).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) + "."
    : "";
  showSaveStatus("Opened " + name + "." + when);
}

async function openFromFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "Bitcoin tax calculator file", accept: { "application/json": [".json"] } }],
      });
      const file = await handle.getFile();
      loadFileText(await file.text(), file.name);
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  document.getElementById("openFileInput").click();
}

async function copySummary() {
  const current = calculateNow();
  if (!current) return;
  const text = summaryText(current.input, current.result);
  const button = document.getElementById("copyBtn");
  try {
    if (android) android.copyText(text);
    else await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch (error) {
    button.textContent = "Copy failed";
  }
  setTimeout(() => { button.textContent = "Copy summary"; }, 1600);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromCoinGecko() {
  const data = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=aud&include_24hr_change=true&include_last_updated_at=true");
  const aud = Number(data.bitcoin && data.bitcoin.aud);
  if (!(aud > 0)) throw new Error("CoinGecko");
  return {
    aud: BtcTax.money(aud),
    change: Number(data.bitcoin.aud_24h_change),
    updated: data.bitcoin.last_updated_at ? new Date(data.bitcoin.last_updated_at * 1000) : new Date(),
    source: "CoinGecko",
  };
}

async function fromCoinbase() {
  const data = await fetchJson("https://api.coinbase.com/v2/prices/BTC-AUD/spot");
  const aud = Number(data.data && data.data.amount);
  if (!(aud > 0)) throw new Error("Coinbase");
  return { aud: BtcTax.money(aud), change: null, updated: new Date(), source: "Coinbase" };
}

async function fromKraken() {
  const data = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTAUD");
  const pair = data.result && Object.values(data.result)[0];
  const aud = Number(pair && pair.c && pair.c[0]);
  if (!(aud > 0)) throw new Error("Kraken");
  return { aud: BtcTax.money(aud), change: null, updated: new Date(), source: "Kraken" };
}

function loadSavedPrice() {
  const raw = localStorage.getItem(PRICE_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (!(saved.aud > 0)) return null;
    return {
      aud: BtcTax.money(saved.aud),
      change: Number.isFinite(saved.change) ? saved.change : null,
      updated: saved.updated ? new Date(saved.updated) : new Date(),
      source: saved.source || "Saved price",
      cached: true,
    };
  } catch (error) {
    return null;
  }
}

async function fetchPrice() {
  if (state.loadingPrice) return;
  state.loadingPrice = true;
  const button = document.getElementById("refreshPrice");
  button.disabled = true;
  const attempts = [fromCoinGecko, fromCoinbase, fromKraken];
  let found = null;
  for (const attempt of attempts) {
    try {
      found = await attempt();
      if (found && found.aud > 0) break;
    } catch (error) {
      found = null;
    }
  }
  if (found) {
    found.cached = false;
    state.price = found;
    state.priceError = "";
    localStorage.setItem(PRICE_KEY, JSON.stringify({
      aud: found.aud,
      change: found.change,
      updated: found.updated.toISOString(),
      source: found.source,
    }));
  } else {
    const saved = loadSavedPrice();
    state.priceError = "Live price unavailable.";
    if (saved) state.price = saved;
  }
  state.loadingPrice = false;
  button.disabled = false;
  renderTicker();
  calculateNow();
}

function registerApp() {
  if (android) {
    document.documentElement.classList.add("android");
    document.getElementById("saveHint").textContent =
      "Save everything on this page, including all your purchases, to a file on this phone. Open it later to carry on where you left off. Your entries are also kept in the app between visits.";
    window.onAndroidFileSaved = (status, name) => {
      if (status === "ok") showSaveStatus("Saved as " + name + ".");
      else if (status === "error") showSaveStatus("The file could not be saved.");
    };
    return;
  }
  if (location.protocol === "file:") {
    fileBanner.hidden = false;
    return;
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredPrompt = event;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { installBtn.hidden = true; });
}

form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("input", (event) => {
  if (event.target.matches && event.target.matches('input[inputmode="decimal"]')) {
    formatNumberInput(event.target);
  }
}, true);
form.addEventListener("input", () => {
  syncVisibility();
  save();
  calculateNow();
});
form.addEventListener("change", () => {
  syncVisibility();
  save();
  calculateNow();
});

parcelRows.addEventListener("input", (event) => {
  const input = event.target.closest("input[data-field]");
  const row = event.target.closest("tr[data-index]");
  if (!input || !row) return;
  const purchase = state.purchases[Number(row.dataset.index)];
  if (purchase) purchase[input.dataset.field] = input.value;
  updateParcelSummary();
});

parcelRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  state.purchases.splice(Number(button.dataset.remove), 1);
  renderParcelRows();
  save();
  calculateNow();
});

document.getElementById("addPurchase").addEventListener("click", () => {
  state.purchases.push(blankPurchase());
  renderParcelRows();
  save();
  calculateNow();
  const inputs = parcelRows.querySelectorAll('input[data-field="date"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

document.getElementById("clearPurchases").addEventListener("click", () => {
  if (!state.purchases.length) return;
  if (!confirm("Remove all " + state.purchases.length + " purchases? Save to a file first if you want to keep them.")) return;
  state.purchases = [];
  renderParcelRows();
  save();
  calculateNow();
});

document.getElementById("saveFileBtn").addEventListener("click", saveToFile);
document.getElementById("openFileBtn").addEventListener("click", openFromFile);
document.getElementById("openFileInput").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  loadFileText(await file.text(), file.name);
  event.target.value = "";
});

document.getElementById("exampleBtn").addEventListener("click", loadExample);
document.getElementById("resetBtn").addEventListener("click", resetForm);
document.getElementById("copyBtn").addEventListener("click", copySummary);
document.getElementById("printBtn").addEventListener("click", () => {
  if (android) android.print();
  else window.print();
});
document.getElementById("refreshPrice").addEventListener("click", fetchPrice);

restore();
if (!form.elements.disposed.value) form.elements.disposed.value = todayISO();
renderParcelRows();
syncVisibility();
const savedPrice = loadSavedPrice();
if (savedPrice) {
  state.price = savedPrice;
  state.priceError = "Showing the last saved price while a live price loads.";
}
renderTicker();
calculateNow();
registerApp();
fetchPrice();
setInterval(fetchPrice, 60000);
