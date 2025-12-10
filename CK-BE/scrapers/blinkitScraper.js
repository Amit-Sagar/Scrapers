const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");
const productScraper = require("./productScraper");
const saveProducts = require("../services/saveProduct"); // intentionally disabled

const BASE_URL = "https://blinkit.com";

puppeteer.use(StealthPlugin());

/**
 * small helper sleep (works in all node + puppeteer versions)
 */
function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

/**
 * Safe goto with two retries and different waitUntil strategies.
 * Returns true if page loaded, false if failed.
 */
async function safeGoto(page, url, name = "") {
    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        return true;
    } catch (err) {
        console.log(`⚠️ First attempt to load ${name || url} failed: ${err.message}. Retrying...`);
        try {
            await page.goto(url, { waitUntil: "load", timeout: 30000 });
            return true;
        } catch (err2) {
            console.log(`❌ Second attempt to load ${name || url} failed: ${err2.message}`);
            return false;
        }
    }
}

/**
 * Gradual autoscroll to force lazy loading. Accepts a page object.
 * scrollSteps - how many viewport scrolls to make (default 12)
 */
async function gradualScroll(page, scrollSteps = 12, delayMs = 400) {
    try {
        // scroll a few times to trigger lazy loads
        for (let i = 0; i < scrollSteps; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await sleep(delayMs);
        }
        // small extra scroll to bottom
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(800);
    } catch (err) {
        // ignore scroll errors
    }
}

/**
 * Force lazy images to populate src/srcset from data attributes
 * (runs inside page context)
 */
async function forceLazyImages(page) {
    try {
        await page.evaluate(() => {
            // convert data-src, data-srcset to src/srcset for all images
            document.querySelectorAll("img").forEach(img => {
                const d = img.getAttribute("data-src");
                const ds = img.getAttribute("data-srcset");
                if (d && (!img.src || img.src.includes("placeholder"))) img.src = d;
                if (ds && (!img.getAttribute("srcset") || img.getAttribute("srcset").includes("placeholder"))) {
                    img.setAttribute("srcset", ds);
                }
            });

            // handle inline style background-image placeholders
            document.querySelectorAll("[style]").forEach(el => {
                const s = el.getAttribute("style") || "";
                const m = s.match(/background-image:\s*url\(['"]?(.*?)['"]?\)/i);
                if (m && m[1] && m[1].includes("data:") === false) {
                    // if there's a nested <img> placeholder, ignore; otherwise nothing to do here
                }
            });
        });
        // give the browser time to update DOM and load images
        await sleep(900);
    } catch (err) {
        // non-fatal
    }
}

async function scrapeBlinkit() {
    console.log("🚀 Starting Blinkit Scraper...");

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--start-maximized"
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );

    // initial navigation
    const ok = await safeGoto(page, BASE_URL, "home");
    if (!ok) {
        console.log("❌ Cannot load Blinkit home. Exiting.");
        await browser.close();
        return;
    }

    // handle app download modal (if present)
    try {
        console.log("🧱 Checking for app download modal...");
        await page.waitForSelector('[class*="AppInstallModal"] button', { timeout: 5000 });
        await page.click('[class*="AppInstallModal"] button');
        console.log("🔘 Clicked 'Continue on web'");
        await sleep(800);
    } catch (e) {
        console.log("✅ No app install modal.");
    }

    // try location selection (best-effort)
    try {
        await page.waitForSelector('[class*="LocationModal"] button', { timeout: 5000 });
        await page.click('[class*="LocationModal"] button');
        await page.waitForSelector("input[type='text']", { timeout: 5000 });
        await page.type("input[type='text']", "New Delhi", { delay: 100 });
        await page.waitForSelector('[class*="AddressItem"]', { timeout: 7000 });
        await page.click('[class*="AddressItem"]');
        console.log("📍 Location selected");
        await page.waitForSelector("footer", { timeout: 10000 });
    } catch (e) {
        console.log("✅ Location selection not needed or already done.");
    }

    // scroll to footer to ensure footer links are loaded
    try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(800);
        await page.waitForSelector("footer", { timeout: 10000 });
    } catch (err) {
        // ignore; footer sometimes lazy loads
    }

    console.log("📦 Extracting categories from footer...");
    const categories = await page.evaluate(() => {
        const items = document.querySelectorAll("footer a[href^='/cn/']");
        return Array.from(items).map((el) => ({
            name: el.innerText.trim(),
            url: el.getAttribute("href"),
        }));
    });

    const categoryList = categories
        .filter((cat) => cat.url && cat.url.startsWith("/cn/"))
        .map((cat) => ({
            ...cat,
            fullUrl: BASE_URL + cat.url,
        }));

    console.log(`✅ Found ${categoryList.length} categories`);

    const allProducts = [];

    // loop categories sequentially (blinkit can block when too many parallel pages)
    // let categoryCounter = 0;
    for (const cat of categoryList) {
        // // limiting the scrape to first category for testing
        // if(categoryCounter>0){
        //     console.log('🔶 Limiting to first category for testing. Exiting loop.');
        //     break;
        // }
        // categoryCounter++;
        console.log(`\n🌐 Navigating to category: ${cat.fullUrl}`);
        const categoryPage = await browser.newPage();

        // set user agent per page (optional)
        await categoryPage.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        );

        const loaded = await safeGoto(categoryPage, cat.fullUrl, `category ${cat.name}`);
        if (!loaded) {
            console.log(`⚠️ Skipping category ${cat.name} due to load failure.`);
            await categoryPage.close();
            continue;
        }

        // small delay and gentle scroll to make JS render lists
        await gradualScroll(categoryPage, 8, 350);

        // force lazy images and attributes to materialize
        await forceLazyImages(categoryPage);

        // look for subcategory buttons; if none, scrape current PLP
        let subcatNodes = [];
        try {
            // try direct query
            subcatNodes = await categoryPage.$$eval(
                "div[role='button'][id^='category_']",
                (nodes) => nodes.map((el, index) => ({
                    name: el.querySelector("div.tw-text-100")?.innerText.trim() || `Subcategory ${index + 1}`,
                    index
                }))
            );
        } catch (err) {
            subcatNodes = [];
        }

        if (!subcatNodes || subcatNodes.length === 0) {
            console.log(`⚠️ No subcategories found for ${cat.name}, scraping page directly...`);
            try {
                // ensure products lazy load on PLP
                await gradualScroll(categoryPage, 12, 300);
                await forceLazyImages(categoryPage);
                const products = await productScraper(categoryPage, cat.name);
                if (products && products.length) {
                    allProducts.push(products);
                    await saveProducts(products, "blinkit"); // intentionally disabled
                    console.log(`✅ Scraped ${products.length} products from ${cat.name}`);
                } else {
                    console.log(`⚠️ No products found on ${cat.name}`);
                }
            } catch (err) {
                console.error(`❌ Failed to scrape category page ${cat.name}: ${err.message}`);
            } finally {
                await categoryPage.close();
            }
            continue;
        }

        console.log(`📑 Found ${subcatNodes.length} subcategories in ${cat.name}`);

        // iterate subcategories
        for (const subcat of subcatNodes) {
            console.log(`🛒 Scraping subcategory: ${subcat.name}`);
            try {
                // re-query buttons each iteration (DOM may change)
                const buttons = await categoryPage.$$("div[role='button'][id^='category_']");
                if (!buttons || buttons.length === 0 || subcat.index >= buttons.length) {
                    console.log(`⚠️ Subcategory button not present; skipping ${subcat.name}`);
                    continue;
                }

                // click and wait short time for UI to reveal products
                try {
                    await buttons[subcat.index].click({ delay: 50 });
                } catch (clickErr) {
                    // fallback: evaluate a click inside page
                    await categoryPage.evaluate((i) => {
                        const btn = document.querySelectorAll("div[role='button'][id^='category_']")[i];
                        if (btn) btn.click();
                    }, subcat.index);
                }

                await sleep(1000);
                await gradualScroll(categoryPage, 10, 300);
                await forceLazyImages(categoryPage);
                await sleep(700);

                const products = await productScraper(categoryPage, cat.name);
                if (products && products.length) {
                    allProducts.push(products);
                    await saveProducts(products, "blinkit"); // intentionally disabled
                    console.log(`✅ Scraped ${products.length} products from ${subcat.name}`);
                } else {
                    console.log(`⚠️ No products found for ${subcat.name}`);
                }

                // small pause between subcategories to reduce rate of requests
                await sleep(600);
            } catch (err) {
                console.error(`❌ Failed to scrape subcategory ${subcat.name}: ${err.message}`);
            }
        }

        await categoryPage.close();
    }

    // still save JSON for backup
    const dataDir = path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, "blinkit-data.json"), JSON.stringify(allProducts, null, 2));

    await browser.close();
    console.log("🎉 Blinkit scraping complete!");
}

module.exports = scrapeBlinkit;
