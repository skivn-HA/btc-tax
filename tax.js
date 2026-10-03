"use strict";

// Australian bitcoin tax estimate for individual taxpayers.
// Rate tables checked October 2026 against ATO resident and foreign-resident
// income tax rates, CGT discount rules, Medicare levy and surcharge, LITO,
// and study and training loan repayment thresholds.
// This is an estimator, not a lodgment or tax advice.

const MEDICARE_SINGLE = { lower: 28011, upper: 35013 };

const FOREIGN_BRACKETS = [
  { from: 0, upTo: 135000, rate: 0.3, base: 0 },
  { from: 135000, upTo: 190000, rate: 0.37, base: 40500 },
  { from: 190000, upTo: Infinity, rate: 0.45, base: 60850 },
];

const HELP_2025_26 = {
  nilTo: 67000,
  midTo: 125000,
  midBase: 8700,
  topAt: 179285,
  rate1: 0.15,
  rate2: 0.17,
  topRate: 0.1,
};

const HELP_2026_27 = {
  nilTo: 69528,
  midTo: 129717,
  midBase: 9028,
  topAt: 186050,
  rate1: 0.15,
  rate2: 0.17,
  topRate: 0.1,
};

const MLS_2025_26 = {
  single: [101000, 118000, 158000],
  family: [202000, 236000, 316000],
  perChild: 1500,
};

const MLS_2026_27 = {
  single: [105000, 123000, 164000],
  family: [210000, 246000, 328000],
  perChild: 1500,
};

const YEARS = {
  "2025-26": {
    label: "2025–26",
    resident: residentBrackets(0.16, 4288, 31288, 51638),
    foreign: FOREIGN_BRACKETS,
    help: HELP_2025_26,
    mls: MLS_2025_26,
    provisional: false,
    note: "Resident rates for 2025–26. Income from $18,201 to $45,000 is taxed at 16%.",
  },
  "2026-27": {
    label: "2026–27",
    resident: residentBrackets(0.15, 4020, 31020, 51370),
    foreign: FOREIGN_BRACKETS,
    help: HELP_2026_27,
    mls: MLS_2026_27,
    provisional: false,
    note: "Resident rates for 2026–27. From 1 July 2026 the rate from $18,201 to $45,000 is 15%.",
  },
  "2027-28": {
    label: "2027–28",
    resident: residentBrackets(0.14, 3752, 30752, 51102),
    foreign: FOREIGN_BRACKETS,
    help: HELP_2026_27,
    mls: MLS_2026_27,
    provisional: true,
    note: "Resident rates legislated for 2027–28. From 1 July 2027 the rate from $18,201 to $45,000 is 14%. Study-loan and Medicare levy surcharge thresholds for 2027–28 are not published yet, so those two items use the 2026–27 thresholds.",
  },
};

function residentBrackets(firstRate, base45, base135, base190) {
  return [
    { from: 0, upTo: 18200, rate: 0, base: 0 },
    { from: 18200, upTo: 45000, rate: firstRate, base: 0 },
    { from: 45000, upTo: 135000, rate: 0.3, base: base45 },
    { from: 135000, upTo: 190000, rate: 0.37, base: base135 },
    { from: 190000, upTo: Infinity, rate: 0.45, base: base190 },
  ];
}

function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100 + Math.sign(x) * 1e-8) / 100;
}

function portion(amount, rate) {
  const cents = Math.round(Number(amount) * 100);
  const ppm = Math.round(Number(rate) * 1e6);
  if (!Number.isFinite(cents) || !Number.isFinite(ppm) || !ppm) return 0;
  return Math.round((cents * ppm) / 1e6) / 100;
}

function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function audAmount(v) {
  return money(Math.max(0, num(v)));
}

function btcAmount(v) {
  const n = num(v);
  if (!(n > 0)) return 0;
  return Math.round(n * 1e8) / 1e8;
}

function proceedsFrom(btc, price) {
  const sats = Math.round(btc * 1e8);
  const priceCents = Math.round(price * 100);
  if (!sats || !priceCents) return 0;
  return Math.round((sats * priceCents) / 1e8) / 100;
}

function formatAUD(n, withCents) {
  const cents = withCents !== false;
  const rounded = money(n);
  const sign = rounded < 0 ? "−" : "";
  const formatted = Math.abs(rounded).toLocaleString("en-AU", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return sign + "$" + formatted;
}

function formatRate(rate) {
  const pct = rate * 100;
  const text = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0$/, "");
  return text + "%";
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatISODate(date) {
  const z = (n) => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + z(date.getMonth() + 1) + "-" + z(date.getDate());
}

function formatPretty(date) {
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function formatDuration(start, end) {
  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(end.getFullYear(), end.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const parts = [];
  if (years) parts.push(years + (years === 1 ? " year" : " years"));
  if (months) parts.push(months + (months === 1 ? " month" : " months"));
  if (days || !parts.length) parts.push(days + (days === 1 ? " day" : " days"));
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

function dateStatus(acquired, disposed) {
  const start = parseISODate(acquired);
  const end = parseISODate(disposed);
  if (!start || !end) return null;
  if (end.getTime() <= start.getTime()) return { invalid: true };
  const anniversary = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
  const discountFrom = addDays(anniversary, 1);
  return {
    invalid: false,
    qualifies: end.getTime() > anniversary.getTime(),
    label: formatDuration(start, end),
    discountFrom,
    discountFromPretty: formatPretty(discountFrom),
    discountFromISO: formatISODate(discountFrom),
  };
}

function financialYearKey(date) {
  const start = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return start + "-" + String((start + 1) % 100).padStart(2, "0");
}

function taxOn(income, brackets) {
  const inc = money(Math.max(0, income));
  if (inc <= 0) return 0;
  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    if (inc <= bracket.upTo || i === brackets.length - 1) {
      return money(bracket.base + portion(Math.max(0, inc - bracket.from), bracket.rate));
    }
  }
  return 0;
}

function litoAmount(income) {
  const inc = money(Math.max(0, income));
  if (inc <= 37500) return 700;
  if (inc <= 45000) return Math.max(0, money(700 - portion(inc - 37500, 0.05)));
  if (inc <= 66667) return Math.max(0, money(325 - portion(inc - 45000, 0.015)));
  return 0;
}

function medicareLevy(income, ctx) {
  if (!ctx.resident || ctx.medicareExempt) return 0;
  const inc = money(Math.max(0, income));
  if (inc <= MEDICARE_SINGLE.lower) return 0;
  if (inc <= MEDICARE_SINGLE.upper) return portion(inc - MEDICARE_SINGLE.lower, 0.1);
  return portion(inc, 0.02);
}

function mlsRateFor(income, bands) {
  const [tier1, tier2, tier3] = bands;
  if (income <= tier1) return 0;
  if (income <= tier2) return 0.01;
  if (income <= tier3) return 0.0125;
  return 0.015;
}

function medicareSurcharge(ownIncome, ctx) {
  if (!ctx.resident || ctx.privateHospital) return { rate: 0, amount: 0 };
  const own = money(Math.max(0, ownIncome));
  const combined = ctx.useFamily ? money(own + ctx.spouse) : own;
  const bands = ctx.useFamily ? ctx.year.mls.family : ctx.year.mls.single;
  const extraChildren = ctx.useFamily ? Math.max(0, ctx.dependants - 1) * ctx.year.mls.perChild : 0;
  const adjusted = bands.map((band) => band + extraChildren);
  const rate = mlsRateFor(combined, adjusted);
  return { rate, amount: portion(own, rate) };
}

function helpFormula(income, rules) {
  const inc = money(Math.max(0, income));
  if (inc <= rules.nilTo) return 0;
  if (inc <= rules.midTo) return portion(inc - rules.nilTo, rules.rate1);
  if (inc <= rules.topAt) return money(rules.midBase + portion(inc - rules.midTo, rules.rate2));
  return portion(inc, rules.topRate);
}

function studyLoan(taxableIncome, ctx) {
  if (!ctx.hasHelp) return 0;
  const repaymentIncome = money(Math.max(0, taxableIncome) + ctx.helpExtra);
  let repay = helpFormula(repaymentIncome, ctx.year.help);
  if (ctx.helpBalance > 0) repay = Math.min(repay, ctx.helpBalance);
  return money(repay);
}

function assess(taxableIncome, ctx) {
  const income = money(Math.max(0, taxableIncome));
  const brackets = ctx.resident ? ctx.year.resident : ctx.year.foreign;
  const bracketTax = taxOn(income, brackets);
  const lito = ctx.resident ? litoAmount(income) : 0;
  const litoUsed = Math.min(lito, bracketTax);
  const incomeTax = money(Math.max(0, bracketTax - litoUsed));
  const medicare = medicareLevy(income, ctx);
  const mls = medicareSurcharge(income, ctx);
  const help = studyLoan(income, ctx);
  const tax = money(incomeTax + medicare + mls.amount);
  return {
    taxableIncome: income,
    bracketTax,
    lito,
    litoUsed,
    incomeTax,
    medicare,
    mlsRate: mls.rate,
    mls: mls.amount,
    help,
    tax,
    cash: money(tax + help),
  };
}

function slicesBetween(startIncome, endIncome, brackets) {
  const slices = [];
  let cursor = money(Math.max(0, startIncome));
  const target = money(Math.max(0, endIncome));
  if (target <= cursor) return slices;
  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    if (cursor >= target) break;
    if (bracket.upTo <= cursor && i !== brackets.length - 1) continue;
    const sliceToRaw = Math.min(target, bracket.upTo);
    const amount = money(sliceToRaw - cursor);
    if (amount > 0) {
      slices.push({
        from: cursor,
        to: money(cursor + amount),
        rate: bracket.rate,
        amount,
        tax: portion(amount, bracket.rate),
      });
      cursor = money(cursor + amount);
    }
  }
  return slices;
}

function resolveHolding(input, forceDiscount) {
  const dates = dateStatus(input.acquired, input.disposed);
  const warnings = [];
  const info = [];
  let applies = false;
  let label = "Under 12 months";

  if (!input.resident) {
    label = input.holding === "over12" ? "12 months or more" : label;
    if (dates && !dates.invalid) label = dates.label;
    warnings.push(
      "Foreign residents do not get the 50% CGT discount. Bitcoin is often outside Australian CGT for a foreign resident. This estimate still calculates the tax as if the gain is taxable in Australia."
    );
    return { applies: false, rate: 0, label, dates, warnings, info };
  }

  if (forceDiscount) {
    return { applies: true, rate: 0.5, label: "12 months or more", dates, warnings, info, forced: true };
  }

  if (input.holding === "over12") {
    applies = true;
    label = "12 months or more";
    if (dates && !dates.invalid && !dates.qualifies) {
      warnings.push(
        "You chose 12 months or more, but these dates do not meet the ATO test yet. The 50% discount starts on " +
          dates.discountFromPretty +
          ", because both the buy date and the sale date are excluded."
      );
    }
  } else if (input.holding === "dates") {
    if (!dates) {
      label = "Dates needed";
      warnings.push("Enter both the acquisition date and the sale date, or choose a holding period above.");
    } else if (dates.invalid) {
      label = "Check the dates";
      warnings.push("The sale date needs to be after the date you acquired the bitcoin.");
    } else {
      applies = dates.qualifies;
      label = dates.label;
      if (!dates.qualifies) {
        info.push(
          "Held for " +
            dates.label +
            ". That is not long enough for the 50% discount. It starts on " +
            dates.discountFromPretty +
            "."
        );
      }
    }
  } else {
    applies = false;
    label = "Under 12 months";
    if (dates && !dates.invalid && dates.qualifies) {
      warnings.push(
        "These dates meet the 12-month test, but the holding period is set to under 12 months, so no discount is applied."
      );
    }
  }

  return { applies, rate: applies ? 0.5 : 0, label, dates, warnings, info };
}

function normalise(raw) {
  const source = raw || {};
  const yearKey = YEARS[source.year] ? source.year : "2026-27";
  const holding = ["under12", "over12", "dates"].includes(source.holding) ? source.holding : "under12";
  const profitMode = source.profitMode === "profit" ? "profit" : "cost";
  const dependants = Math.max(0, Math.floor(num(source.dependants)));
  const family = !!source.family || dependants > 0;
  return {
    yearKey,
    year: YEARS[yearKey],
    resident: source.resident !== false && source.resident !== "foreign",
    paye: audAmount(source.paye),
    otherIncome: audAmount(source.otherIncome),
    deductions: audAmount(source.deductions),
    withheld: audAmount(source.withheld),
    btc: btcAmount(source.btc),
    price: money(Math.max(0, num(source.priceAud))),
    sellFees: audAmount(source.sellFees),
    profitMode,
    costBase: audAmount(source.costBase),
    knownProfit: money(num(source.knownProfit)),
    capitalLosses: audAmount(source.capitalLosses),
    holding,
    acquired: source.acquired || "",
    disposed: source.disposed || "",
    medicareExempt: !!source.medicareExempt,
    privateHospital: source.privateHospital === undefined ? true : !!source.privateHospital,
    family,
    familyChosen: !!source.family,
    spouse: audAmount(source.spouseIncome),
    dependants,
    hasHelp: !!source.hasHelp,
    helpBalance: audAmount(source.helpBalance),
    helpExtra: audAmount(source.helpExtra),
  };
}

function compute(raw, forceDiscount) {
  const input = normalise(raw);
  const holding = resolveHolding(input, forceDiscount);
  const warnings = holding.warnings.slice();
  const notes = (holding.info || []).slice();

  let proceeds = 0;
  let costBase = input.costBase;
  let grossGain = 0;
  const needsBitcoin = input.profitMode === "cost" && !(input.btc > 0);
  const needsPrice = input.profitMode === "cost" && input.btc > 0 && !(input.price > 0);

  if (input.profitMode === "profit") {
    grossGain = input.knownProfit;
    if (input.btc > 0 && input.price > 0) {
      proceeds = proceedsFrom(input.btc, input.price);
      costBase = money(proceeds - grossGain);
      if (grossGain > proceeds + 0.009) {
        warnings.push(
          "The capital profit is higher than the sale proceeds at this price. Check the bitcoin amount, the price, and the profit."
        );
      }
    } else if (input.btc > 0 || input.price > 0) {
      notes.push("Sale proceeds are incomplete, so tax is based only on the capital profit you entered.");
    }
  } else if (!needsBitcoin && !needsPrice) {
    proceeds = money(proceedsFrom(input.btc, input.price) - input.sellFees);
    costBase = input.costBase;
    grossGain = money(proceeds - costBase);
    if (input.sellFees > proceedsFrom(input.btc, input.price)) {
      warnings.push("Selling costs are higher than the bitcoin sale proceeds. Check the fee.");
    }
  }

  if (needsPrice) {
    warnings.push("There is no AUD price yet. Wait for the live price, or enter your own.");
  }

  let lossPool = input.capitalLosses;
  let gainAfterLosses = money(Math.max(0, grossGain));
  let lossesUsed = 0;
  if (grossGain >= 0) {
    lossesUsed = money(Math.min(lossPool, gainAfterLosses));
    gainAfterLosses = money(gainAfterLosses - lossesUsed);
    lossPool = money(lossPool - lossesUsed);
  } else {
    lossPool = money(lossPool + Math.abs(grossGain));
    gainAfterLosses = 0;
  }

  const discountApplies = holding.applies && gainAfterLosses > 0;
  const discountAmount = discountApplies ? money(gainAfterLosses * holding.rate) : 0;
  const netCapitalGain = money(gainAfterLosses - discountAmount);
  const lossCarryForward = lossPool;

  const ordinary = money(input.paye + input.otherIncome);
  const baseTaxable = money(Math.max(0, ordinary - input.deductions));
  const newTaxable = money(Math.max(0, ordinary + netCapitalGain - input.deductions));

  const ctx = {
    resident: input.resident,
    year: input.year,
    medicareExempt: input.medicareExempt,
    privateHospital: input.privateHospital,
    useFamily: input.family,
    spouse: input.spouse,
    dependants: input.dependants,
    hasHelp: input.hasHelp,
    helpBalance: input.helpBalance,
    helpExtra: input.helpExtra,
  };

  const base = assess(baseTaxable, ctx);
  const next = assess(newTaxable, ctx);
  const extra = {
    incomeTax: money(next.incomeTax - base.incomeTax),
    medicare: money(next.medicare - base.medicare),
    mls: money(next.mls - base.mls),
    help: money(next.help - base.help),
  };
  extra.tax = money(extra.incomeTax + extra.medicare + extra.mls);
  extra.cash = money(extra.tax + extra.help);

  const brackets = input.resident ? input.year.resident : input.year.foreign;
  const slices = slicesBetween(base.taxableIncome, next.taxableIncome, brackets);

  if (input.year.provisional && !forceDiscount) {
    notes.push(input.year.note);
  }
  if (input.family && input.resident && !input.medicareExempt && !forceDiscount) {
    notes.push(
      "Medicare levy reduction for families is not calculated. Once income is above the single-person shade-in, the levy is 2%."
    );
  }
  if (!input.familyChosen && input.dependants > 0 && !forceDiscount) {
    notes.push("Dependent children switch the Medicare levy surcharge to the family thresholds.");
  }
  if (lossesUsed > 0 && !forceDiscount) {
    notes.push(
      "Capital losses of " +
        formatAUD(lossesUsed) +
        " were taken off the gain before the CGT discount. That is the order the ATO uses."
    );
  }
  if (input.hasHelp && input.helpBalance <= 0 && (base.help > 0 || next.help > 0) && !forceDiscount) {
    notes.push("Enter the study-loan balance to cap the repayment. This shows the full compulsory repayment.");
  }
  if (input.hasHelp && input.helpBalance > 0 && next.help >= input.helpBalance && extra.help <= 0 && !forceDiscount) {
    notes.push("The study-loan balance is already repaid by the compulsory repayment on your other income.");
  }
  if (next.mlsRate > base.mlsRate && !forceDiscount) {
    warnings.push(
      "This sale crosses a Medicare levy surcharge threshold, from " +
        formatRate(base.mlsRate) +
        " to " +
        formatRate(next.mlsRate) +
        ". The surcharge applies to your income for the year, which is why this sale adds " +
        formatAUD(extra.mls) +
        " of surcharge."
    );
  }
  if (input.hasHelp && base.help <= 0 && next.help > 0 && !forceDiscount) {
    warnings.push(
      "This sale pushes repayment income over the study-loan threshold, so a compulsory repayment of " +
        formatAUD(next.help) +
        " starts."
    );
  }
  if (base.lito > next.lito + 0.009 && extra.incomeTax > 0 && !forceDiscount) {
    notes.push(
      "The low income tax offset falls by " +
        formatAUD(base.lito - next.lito) +
        " because of this extra income, and that increases the tax."
    );
  }

  const saleDate = parseISODate(input.disposed);
  if (saleDate && !forceDiscount) {
    const fy = financialYearKey(saleDate);
    if (!YEARS[fy]) {
      warnings.push("This calculator does not have rates for " + fy.replace("-", "–") + ". It is using " + input.year.label + ".");
    } else if (fy !== input.yearKey) {
      warnings.push(
        "The sale date falls in " +
          YEARS[fy].label +
          ", but the rates selected are " +
          input.year.label +
          "."
      );
    }
  }

  let story;
  if (needsBitcoin) {
    story = "Enter how much bitcoin you are selling. Your salary is already included in the year totals below.";
  } else if (needsPrice) {
    story = "A sale price in AUD is needed before the profit and tax can be worked out.";
  } else if (grossGain < 0) {
    story =
      "This sale is a capital loss of " +
      formatAUD(Math.abs(grossGain)) +
      ". No tax is payable on it. The loss cannot reduce tax on your salary. It carries forward against later capital gains.";
  } else if (grossGain === 0) {
    story = "There is no capital profit on these figures, so this sale does not add to your taxable income.";
  } else if (netCapitalGain <= 0) {
    story = "After capital losses, none of this sale is added to your taxable income.";
  } else if (extra.tax <= 0) {
    story =
      "Profit that is taxable is " +
      formatAUD(netCapitalGain) +
      ". It does not increase your tax on these figures, because of the tax-free threshold or the low income tax offset.";
  } else if (discountApplies) {
    story =
      "Profit that is taxable is " +
      formatAUD(netCapitalGain) +
      " after the 50% CGT discount. The extra tax on this sale is " +
      formatAUD(extra.tax) +
      ".";
  } else {
    story =
      "Profit that is taxable is " +
      formatAUD(netCapitalGain) +
      ". The 50% discount is not applied, so the whole remaining gain is included. The extra tax on this sale is " +
      formatAUD(extra.tax) +
      ".";
  }

  const lodgement =
    input.withheld > 0
      ? {
          withheld: input.withheld,
          due: money(next.cash - input.withheld),
        }
      : null;

  return {
    yearKey: input.yearKey,
    yearLabel: input.year.label,
    resident: input.resident,
    provisional: input.year.provisional,
    profitMode: input.profitMode,
    needsBitcoin,
    needsPrice,
    btc: input.btc,
    price: input.price,
    proceeds,
    sellFees: input.profitMode === "cost" ? input.sellFees : 0,
    costBase,
    grossGain,
    lossesUsed,
    gainAfterLosses,
    discountApplies,
    discountRate: discountApplies ? 0.5 : 0,
    discountAmount,
    netCapitalGain,
    lossCarryForward,
    holdingLabel: holding.label,
    dates: holding.dates,
    base,
    next,
    extra,
    slices,
    notes,
    warnings,
    story,
    lodgement,
    effectiveOnProfit: grossGain > 0 ? extra.tax / grossGain : 0,
    effectiveOnTaxable: netCapitalGain > 0 ? extra.tax / netCapitalGain : 0,
    marginalIncomeRate: slices.length ? slices[slices.length - 1].rate : 0,
    marginalMedicare:
      input.resident && !input.medicareExempt
        ? next.taxableIncome > MEDICARE_SINGLE.upper
          ? 0.02
          : next.taxableIncome > MEDICARE_SINGLE.lower
            ? 0.1
            : 0
        : 0,
    withheld: input.withheld,
  };
}

function calculate(raw) {
  const result = compute(raw, false);
  if (result.resident && !result.discountApplies && result.gainAfterLosses > 0 && !result.needsBitcoin && !result.needsPrice) {
    const alternate = compute(raw, true);
    result.discountSaving = money(result.extra.tax - alternate.extra.tax);
    result.discountSavingHelp = money(result.extra.help - alternate.extra.help);
    result.taxIfDiscounted = alternate.extra.tax;
    result.taxableIfDiscounted = alternate.netCapitalGain;
  } else {
    result.discountSaving = 0;
    result.discountSavingHelp = 0;
    result.taxIfDiscounted = null;
    result.taxableIfDiscounted = null;
  }
  return result;
}

function bracketFormula(bracket) {
  const cents = Math.round(bracket.rate * 100);
  if (bracket.rate === 0) return "Nil";
  if (bracket.base === 0 && bracket.from === 0) return cents + "c per $1";
  if (bracket.base === 0) return cents + "c per $1 over " + formatAUD(bracket.from, false);
  return formatAUD(bracket.base, false) + " plus " + cents + "c per $1 over " + formatAUD(bracket.from, false);
}

function describeYear(yearKey, resident) {
  const key = YEARS[yearKey] ? yearKey : "2026-27";
  const year = YEARS[key];
  const brackets = resident === false ? year.foreign : year.resident;
  const lines = brackets.map((bracket) => {
    const top = bracket.upTo === Infinity ? "and over" : "– " + formatAUD(bracket.upTo, false);
    const range = bracket.from === 0 && bracket.upTo !== Infinity
      ? "0 – " + formatAUD(bracket.upTo, false)
      : formatAUD(bracket.from, false) + " " + top;
    return {
      range,
      rate: formatRate(bracket.rate),
      formula: bracketFormula(bracket),
    };
  });
  const notes = [year.note];
  if (resident !== false) {
    notes.push(
      "Medicare levy is 2% of taxable income. Singles pay none at or below " +
        formatAUD(MEDICARE_SINGLE.lower, false) +
        ", and a reduced levy up to " +
        formatAUD(MEDICARE_SINGLE.upper, false) +
        "."
    );
    notes.push("Low income tax offset is up to $700 for residents and cuts out above " + formatAUD(66667, false) + ".");
    notes.push(
      "Medicare levy surcharge for someone without private hospital cover: 1%, 1.25% and 1.5% above the single thresholds " +
        year.mls.single.map((n) => formatAUD(n, false)).join(", ") +
        ". Family thresholds start at " +
        formatAUD(year.mls.family[0], false) +
        ", plus " +
        formatAUD(year.mls.perChild, false) +
        " for each dependent child after the first."
    );
  } else {
    notes.push("Foreign-resident rates have no tax-free threshold. Medicare levy and the surcharge are not included.");
  }
  notes.push(
    "Study-loan repayment for " +
      (year.provisional ? "2026–27, used here for 2027–28" : year.label) +
      ": nil to " +
      formatAUD(year.help.nilTo, false) +
      ", then 15% of the excess, 17% from " +
      formatAUD(year.help.midTo + 1, false) +
      ", and 10% of total repayment income from " +
      formatAUD(year.help.topAt + 1, false) +
      "."
  );
  notes.push(
    "Australian residents get a 50% CGT discount on bitcoin held at least 12 months. Capital losses come off first. The buy date and the sale date are both excluded from the 12 months."
  );
  return { key, label: year.label, lines, notes, provisional: year.provisional };
}

const BtcTax = { calculate, describeYear, formatAUD, money, YEARS };

if (typeof module !== "undefined" && module.exports) {
  module.exports = BtcTax;
}
