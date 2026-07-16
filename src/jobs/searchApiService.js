// jobs/searchApiService.js

const KNOWN_PLATFORM_NAMES = {
  "amazon.in": "Amazon", "flipkart.com": "Flipkart", "croma.com": "Croma",
  "reliancedigital.in": "Reliance Digital", "vijaysales.com": "Vijay Sales",
  "tatacliq.com": "Tata CLiQ", "myntra.com": "Myntra", "ajio.com": "AJIO",
  "meesho.com": "Meesho", "nykaa.com": "Nykaa"
};

const DISALLOWED_HOSTS = new Set([
  "youtube.com", "reddit.com", "quora.com", "wikipedia.org", "google.com",
  "facebook.com", "instagram.com", "pinterest.com", "twitter.com"
]);

const VARIANT_WORDS = new Set(["pro", "plus", "max", "ultra", "mini", "lite", "neo", "fe"]);
const IGNORED_QUERY_WORDS = new Set(["price", "buy", "online", "india", "latest", "best", "cheap"]);

function normalize(value) {
  const str = String(value || "").toLowerCase();
  const matches = str.match(/[a-z0-9]+/g);
  return matches ? matches.join(" ") : "";
}

const BLOCKED_WORDS = [
  "refurbished", "renewed", "second hand", "used", "open box", "dummy phone",
  "back cover", "case", "tempered glass", "screen guard", "screen protector", 
  "replacement", "charging cable", "digitizer", "lcd display", "earbuds", "earphones"
].map(normalize);

function cleanPrice(value) {
  if (value == null) return null;
  if (typeof value === "number") return value > 0 ? value : null;
  const match = String(value).match(/[\d,]+(?:\.\d{1,2})?/);
  if (!match) return null;
  const parsed = parseFloat(match[0].replace(/,/g, ""));
  return isNaN(parsed) ? null : parsed;
}

function formatPrice(price) {
  try {
    return `₹${Math.round(price).toLocaleString('en-IN')}`;
  } catch (e) {
    return "Price unavailable";
  }
}

function getHostname(urlString) {
  try {
    let hostname = new URL(urlString).hostname.toLowerCase();
    return hostname.startsWith("www.") ? hostname.substring(4) : hostname;
  } catch (e) { return ""; }
}

function platformNameFromUrl(urlString) {
  const hostname = getHostname(urlString);
  if (KNOWN_PLATFORM_NAMES[hostname]) return KNOWN_PLATFORM_NAMES[hostname];
  if (!hostname) return "Unknown store";
  return hostname.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

function isExactProductUrl(urlString, platform) {
  if (!urlString || !urlString.startsWith("http")) return false;
  const lower = urlString.toLowerCase();
  const blocked = ["/search", "?q=", "&q=", "/q/", "search?", "keyword=", "/category", "/collections", "/b?", "node=", "/b/"];
  if (blocked.some(b => lower.includes(b))) return false;

  let path;
  try { path = new URL(urlString).pathname; } catch (e) { return false; }

  if (platform === "Amazon") return lower.includes("/dp/") || lower.includes("/gp/product/");
  if (["Flipkart", "Croma", "Reliance Digital"].includes(platform)) return lower.includes("/p/") || lower.includes("pid=");

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  return true;
}

function priceIsReasonable(productName, price) {
  price = cleanPrice(price);
  if (!price || price <= 0) return false;
  const prod = normalize(productName);
  if (prod.includes("iphone")) return price >= 10000 && price <= 250000;
  if (prod.includes("macbook")) return price >= 20000 && price <= 500000;
  if (["laptop", "phone", "mobile"].some(w => prod.includes(w))) return price >= 2000 && price <= 500000;
  if (["shoe", "shoes", "sneaker", "sneakers", "purse", "bag", "handbag"].some(w => prod.includes(w))) return price >= 150 && price <= 50000;
  return price >= 50 && price <= 1000000;
}

function productMatchScore(query, resultText) {
  const qText = normalize(query);
  const rText = normalize(resultText);
  if (!qText || !rText) return 0;

  for (const w of BLOCKED_WORDS) {
    if (rText.includes(w)) return 0;
  }

  const qWordsRaw = qText.split(" ");
  const qWords = qWordsRaw.filter(w => !IGNORED_QUERY_WORDS.has(w) && !VARIANT_WORDS.has(w) && w.length >= 2);
  const rWords = new Set(rText.split(" "));

  const modelTokens = qWordsRaw.filter(w => /^[a-z]{1,3}\d{1,4}[a-z]{0,2}$/.test(w) || /^\d{1,4}[a-z]{1,3}$/.test(w));
  if (modelTokens.length > 0) {
    if (!modelTokens.every(t => rWords.has(t))) return 0;
    return 100;
  }

  if (qWords.length === 0) return 100;

  let matched = 0;
  for (const w of qWords) {
    if (rWords.has(w)) matched++;
  }

  if (matched === 0) return 60; // Semantic fallback for generic queries
  return Math.round((matched / qWords.length) * 100);
}

async function fetchCatalogSellers(pid, productName) {
  const params = new URLSearchParams({
    engine: "google_product_page",
    product_id: pid,
    api_key: process.env.SERPAPI_API_KEY, // Set this in your Node environment
    gl: "in",
    hl: "en",
    location: "India"
  });

  try {
    const res = await fetch(`https://www.searchapi.io/api/v1/search?${params.toString()}`);
    if (!res.ok) return [];
    
    const data = await res.json();
    const productData = data.product || data.product_results || {};
    const canonicalTitle = (productData.title || "").trim();

    // --- BULLETPROOF IMAGE EXTRACTION (CATALOG) ---
    let thumbnail = "";
    for (const k of ["thumbnail", "image", "images", "imageUrl"]) {
      const val = productData[k];
      if (typeof val === "string" && val.startsWith("http")) {
        thumbnail = val.trim();
        break;
      } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string" && val[0].startsWith("http")) {
        thumbnail = val[0].trim();
        break;
      }
    }
    
    // Fallback to media array
    if (!thumbnail && Array.isArray(productData.media)) {
      for (const m of productData.media) {
        if (m && typeof m === "object") {
          const imgVal = m.link || m.thumbnail || m.image;
          if (typeof imgVal === "string" && imgVal.startsWith("http")) {
            thumbnail = imgVal.trim();
            break;
          }
        }
      }
    }
    // ----------------------------------------------

    const offersData = data.offers || data.sellers_results || {};
    let sellerLists = [];
    if (!Array.isArray(offersData) && typeof offersData === "object") {
      sellerLists = [...(offersData.online_sellers || []), ...(offersData.marketplace_sellers || [])];
    } else if (Array.isArray(offersData)) {
      sellerLists = offersData;
    }

    if (sellerLists.length === 0 && Array.isArray(data.sellers)) {
      sellerLists = data.sellers;
    }

    const sellers = [];
    for (const s of sellerLists) {
      if (!s || typeof s !== "object") continue;
      const link = String(s.direct_link || s.link || s.url || "").trim();
      const price = cleanPrice(s.extracted_price || s.total_price || s.base_price || s.price);

      if (link && price) {
        sellers.push({
          title: canonicalTitle || productName,
          url: link,
          price: price,
          thumbnail: thumbnail,
          source: s.name || "Google Catalog",
          rating: productData.rating,
          reviews: productData.reviews
        });
      }
    }
    return sellers;
  } catch (e) {
    return [];
  }
}

export async function getAggregatedProducts(productName) {
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: productName,
    api_key: process.env.SERPAPI_API_KEY,
    gl: "in",
    hl: "en",
    location: "India",
    num: "40"
  });

  let data;
  try {
    const res = await fetch(`https://www.searchapi.io/api/v1/search?${params.toString()}`);
    if (!res.ok) throw new Error(`SearchApi HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    return { products: [], error: e.message };
  }

  const rawOffers = [];
  const productIdsToCheck = [];

  for (const item of (data.shopping_results || [])) {
    const title = String(item.title || "").trim();
    const link = String(item.link || "").trim();
    const price = cleanPrice(item.price || item.extracted_price);
    const pid = String(item.product_id || "").trim();

    if (pid && !productIdsToCheck.some(p => p.pid === pid)) {
      productIdsToCheck.push({ pid, title });
    }

    if (title && link && price && !link.toLowerCase().includes("google.com")) {
      // --- BULLETPROOF IMAGE EXTRACTION (DIRECT OFFERS) ---
      let imgUrl = "";
      for (const k of ["thumbnail", "image", "images", "imageUrl"]) {
        const val = item[k];
        if (typeof val === "string" && val.startsWith("http")) {
          imgUrl = val.trim();
          break;
        } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string" && val[0].startsWith("http")) {
          imgUrl = val[0].trim();
          break;
        }
      }
      // ----------------------------------------------------

      rawOffers.push({
        title, url: link, price, thumbnail: imgUrl,
        rating: item.rating, reviews: item.reviews,
        source: "Google Shopping Direct"
      });
    }
  }

  let catalogsExpanded = 0;
  for (const p of productIdsToCheck) {
    if (productMatchScore(productName, p.title) > 0) {
      const sellers = await fetchCatalogSellers(p.pid, productName);
      rawOffers.push(...sellers);
      catalogsExpanded++;
      if (catalogsExpanded >= 3) break;
    }
  }

  const candidates = [];
  for (const offer of rawOffers) {
    const link = offer.url;
    const platform = platformNameFromUrl(link);

    if (DISALLOWED_HOSTS.has(getHostname(link))) continue;
    if (!isExactProductUrl(link, platform)) continue;

    const score = productMatchScore(productName, offer.title);
    if (score <= 0 || !priceIsReasonable(productName, offer.price)) continue;

    candidates.push({
      platform,
      product_name: offer.title,
      numeric_price: offer.price,
      price: formatPrice(offer.price),
      url: link,
      product_url: link,
      direct_link: link,
      thumbnail: offer.thumbnail || "",
      rating: offer.rating || "N/A",
      reviews: offer.reviews || "N/A",
      price_verified: false,
      price_source: offer.source,
      match_score: score
    });
  }

  if (candidates.length === 0) return { products: [], error: "No valid exact product links found." };

  const bestPerPlatform = {};
  for (const item of candidates) {
    const plat = item.platform;
    if (!bestPerPlatform[plat] || item.numeric_price < bestPerPlatform[plat].numeric_price) {
      bestPerPlatform[plat] = item;
    }
  }

  const sorted = Object.values(bestPerPlatform)
    .sort((a, b) => a.numeric_price - b.numeric_price)
    .slice(0, 12);

  return { products: sorted, error: null };
}