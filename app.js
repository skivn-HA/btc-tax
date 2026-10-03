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

const state = {
  price: null,
  priceError: "",
  deferredPrompt: null,
  loadingPrice: false,
};

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
    sellFees: fieldValue("profitChoice") === "cost" ? fieldValue("sellFees") : 0,
    profitMode: fieldValue("profitChoice"),
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
  document.getElementById("costFields").hidden = fieldValue("profitChoice") !== "cost";
  document.getElementById("profitFields").hidden = fieldValue("profitChoice") !== "profit";
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
  if (result.costBase != null && (result.profitMode === "cost" || result.btc > 0)) {
    add("Cost base", esc(BtcTax.formatAUD(result.costBase)));
  }
  add("Capital profit", esc(BtcTax.formatAUD(result.grossGain)));
  if (result.lossesUsed > 0) add("Capital losses used", esc(BtcTax.formatAUD(result.lossesUsed)));
  add("Length of time held", esc(result.holdingLabel));
  add("CGT discount", result.discountApplies ? esc(BtcTax.formatAUD(result.discountAmount)) + " off (50%)" : "None");
  add("Profit that is taxable", esc(BtcTax.formatAUD(result.netCapitalGain)), true);
  if (result.lossCarryForward > 0) add("Loss still to carry forward", esc(BtcTax.formatAUD(result.lossCarryForward)));
  return `<h3>How the profit is taxed</h3><dl class="breakdown">${rows.join("")}</dl>`;
}

function renderWait(result) {
  if (!(result.discountSaving > 1)) return "";
  const when = result.dates && !result.dates.invalid && !result.dates.qualifies && result.dates.discountFromPretty
    ? " A sale on or after " + result.dates.discountFromPretty + " would qualify."
    : "";
  let help = "";
  if (result.discountSavingHelp > 1) {
    help = " The extra study-loan repayment would also be " + BtcTax.formatAUD(result.discountSavingHelp) + " lower.";
  }
  return `<div class="callout"><strong>If the 50% discount applied.</strong> Tax on this same profit would be ${esc(BtcTax.formatAUD(result.taxIfDiscounted))} instead, which is ${esc(BtcTax.formatAUD(result.discountSaving))} less.${esc(when + help)}</div>`;
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

  if (result.dates && result.dates.invalid) {
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
  lines.push("Capital profit: " + BtcTax.formatAUD(result.grossGain));
  lines.push("CGT discount: " + (result.discountApplies ? "50%" : "none"));
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

function save() {
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
  localStorage.setItem(STORAGE, JSON.stringify(data));
}

function restore() {
  const raw = localStorage.getItem(STORAGE);
  if (!raw) return false;
  let data;
  try { data = JSON.parse(raw); } catch (error) { return false; }
  for (const [key, value] of Object.entries(data)) {
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
  return true;
}

function setChecked(name, value) {
  const field = form.elements[name];
  if (!field) return;
  for (const radio of field) radio.checked = radio.value === value;
}

function loadExample() {
  const acquired = yearsAgoISO(2);
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
  setChecked("profitChoice", "cost");
  if (state.price) {
    setChecked("priceChoice", "live");
    form.elements.customPrice.value = "";
  } else {
    setChecked("priceChoice", "custom");
    form.elements.customPrice.value = "100000";
  }
  syncVisibility();
  save();
  calculateNow();
}

function resetForm() {
  form.reset();
  localStorage.removeItem(STORAGE);
  form.elements.disposed.value = todayISO();
  syncVisibility();
  save();
  calculateNow();
}

async function copySummary() {
  const current = calculateNow();
  if (!current) return;
  const text = summaryText(current.input, current.result);
  const button = document.getElementById("copyBtn");
  try {
    await navigator.clipboard.writeText(text);
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

document.getElementById("exampleBtn").addEventListener("click", loadExample);
document.getElementById("resetBtn").addEventListener("click", resetForm);
document.getElementById("copyBtn").addEventListener("click", copySummary);
document.getElementById("printBtn").addEventListener("click", () => window.print());
document.getElementById("refreshPrice").addEventListener("click", fetchPrice);

restore();
if (!form.elements.disposed.value) form.elements.disposed.value = todayISO();
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
