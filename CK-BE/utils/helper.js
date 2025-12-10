const { BRANDS, NOISE_WORDS, VARIANTS } = require('./lists');

function normalizeText(t) {
  return t
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[\-_,]/g, " ")      // remove special symbols
    .replace(/\([^)]*\)/g, "")    // remove brackets
    .replace(/\s+/g, " ")         // remove extra spaces
    .trim();
}

function splitWords(t) {
  return t.split(" ").filter(Boolean);
}

function detectQuantity(str) {
  if (!str) return { normalized: null };
  const m = str.match(/(\d+(\.\d+)?)\s*(kg|g|l|ml)/i);
  if (!m) return { normalized: null };

  const num = parseFloat(m[1]);
  const unit = m[3].toLowerCase();

  if (unit === "kg") return { normalized: num * 1000 + "g" };
  if (unit === "g") return { normalized: num + "g" };
  if (unit === "l") return { normalized: num * 1000 + "ml" };
  return { normalized: num + "ml" };
}

function detectBrand(words) {
  const joined = words.join(" ");
  let matched = null;

  for (let brand of BRANDS) {
    const b = brand.toLowerCase();
    if (joined.startsWith(b)) {
      if (!matched || b.length > matched.length) matched = b;
    }
  }

  return matched || words[0];
}

function normalizeCategoryTokens(words) {
  let out = [];
  let drinkFound = false;
  let energyFound = false;
  let chipsFound = false;

  for (let w of words) {
    if (["soft", "drink", "softdrink", "soda", "cola"].includes(w)) {
      drinkFound = true;
      continue;
    }
    if (["energy", "energydrink"].includes(w)) {
      energyFound = true;
      continue;
    }
    if (["chips", "chipps", "crisps", "potato"].includes(w)) {
      chipsFound = true;
      continue;
    }
    out.push(w);
  }

  if (energyFound) out.push("energy_drink");
  else if (drinkFound) out.push("soft_drink");

  if (chipsFound) out.push("chips");

  return out;
}

function normalizeHotSweet(words) {
  let out = [];
  let hot = false, sweet = false;

  for (let w of words) {
    if (w === "hot") { hot = true; continue; }
    if (w === "sweet") { sweet = true; continue; }
    out.push(w);
  }

  if (hot || sweet) out.push("hot_sweet");

  return out;
}


function generateProductId(title, quantity) {
  let clean = normalizeText(title);
  let words = splitWords(clean);

  // 1. Detect brand
  const brand = detectBrand(words);
  const brandWords = brand.split(" ");
  words = words.slice(brandWords.length);

  // 2. Remove noise words
  words = words.filter(w => !NOISE_WORDS.includes(w));

  // 3. Apply category normalization
  words = normalizeCategoryTokens(words);

  // 4. Merge hot/sweet → hot_sweet
  words = normalizeHotSweet(words);

  // 5. Separate variants
  const variants = words.filter(w => VARIANTS.includes(w));
  const rest = words.filter(w => !variants.includes(w));

  // 6. Remove duplicates in core
  const coreUnique = [...new Set(rest.concat(variants))];

  // 7. Detect quantity
  const qty = detectQuantity(quantity);

  // 8. Build final ID (avoid duplicate quantity)
  const finalParts = [brand.replace(/ /g, "_"), ...coreUnique];
  if (qty.normalized && !finalParts.includes(qty.normalized)) {
    finalParts.push(qty.normalized);
  }

  return finalParts.join("_").replace(/_+/g, "-");
}

module.exports = generateProductId;
