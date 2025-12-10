const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const saveProducts = require("../services/saveProduct");

puppeteer.use(StealthPlugin());

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeZepto() {
    console.log("🚀 Starting Zepto Scraper...");
    const browser = await puppeteer.launch({
        headless: true,
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
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );


    // ✅ open zepto and select location (your existing code)...
    console.log("🌐 Opening Zepto homepage...");
    await page.goto("https://www.zeptonow.com", { waitUntil: "networkidle2" });

    // 📍 Select location manually (if popup appears)
    try {
        await page.waitForSelector('[data-testid="ManualLocation"]', { timeout: 5000 });
        await page.click('[data-testid="ManualLocation"]');

        await page.waitForSelector('input[type="text"]', { timeout: 8000 });
        await page.type('input[type="text"]', "Delhi", { delay: 100 });
        await page.waitForTimeout(2000);
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");

        await page.waitForNavigation({ waitUntil: "networkidle2" });
        console.log("📍 Location selected.");
    } catch {
        console.log("⚠️ Location selection skipped or failed.");
    }


    const categories = await page.$$eval(
        'div.mt-4 ul li a',
        (links) => links.map(a => ({ name: a.textContent.trim(), url: a.href }))
    );
    console.log(`📦 Found ${categories.length} categories.`);

    let allProducts = [];

    // Function to scroll until all products load
    async function scrollToEnd(p) {
        let prevHeight = 0;
        while (true) {
            const height = await p.evaluate('document.body.scrollHeight');
            if (height === prevHeight) break;
            prevHeight = height;
            await p.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }

    async function safeWaitForSelector(page, selector, timeout = 15000) {
        try {
            return await page.waitForSelector(selector, { timeout });
        } catch (err) {
            if (err.message.includes("Execution context was destroyed")) {
                console.log("⚠️ Context lost, retrying waitForSelector...");
                await sleep(1000);
                return await page.waitForSelector(selector, { timeout });
            }
            throw err;
        }
    }

    async function scrapeProductGrid(url, categoryPath, retryCount = 0) {
        const productPage = await browser.newPage();
        try {
            console.log(`📂 Scraping category: ${categoryPath}`);
            await productPage.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

            // Give React time to hydrate
            await sleep(2000);

            // Wait for product cards
            await safeWaitForSelector(
                productPage,
                'a[href*="/pn/"] div[data-slot-id="ProductName"] span'
            );

            await scrollToEnd(productPage);
            // Extract product data
            const products = await productPage.$$eval(
                'a[href*="/pn/"]',
                (cards, categoryName) =>
                    cards.map((card) => ({
                        category: categoryName,
                        name:
                            card.querySelector('div[data-slot-id="ProductName"] span')
                                ?.textContent?.trim() || null,
                        price:
                            card.querySelector('div[data-slot-id="EdlpPrice"] span')    /*p._price_ljyvk_11 */
                                ?.textContent?.trim() || null,
                        quantity:
                                (card.querySelector('div[data-slot-id="PackSize"] span')
                                ?.textContent?.trim()?.replace(/\s*/g, '')
                                ?.match(/(\d+(?:\.\d+)?)(g|kg|mg|ml|l)/i)
                                ?.[0])
                                || null,
                        image:
                            card.querySelector('div[data-slot-id="ProductImageWrapper"] img')
                                ?.src || null,
                        deepLink: card.href || null,
                        brand: null,
                        source: "zepto",
                    })),
                categoryPath
            );

            const validProducts = products.filter(p => p.name && p.quantity);
            allProducts.push(...validProducts);

            //         // 🔹 Save to Elasticsearch
            await saveProducts(validProducts, "zepto");
            console.log(
                `✅ Found ${products.length} products in category: ${categoryPath}`
            );
        } catch (err) {
            if (
                err.message.includes("Execution context was destroyed") &&
                retryCount < 2
            ) {
                console.log(`⚠️ Context destroyed, retrying scrape (${retryCount + 1})...`);
                await productPage.close();
                return await scrapeProductGrid(url, categoryPath, retryCount + 1);
            } else {
                console.error(`❌ Error scraping category ${categoryPath}:`, err.message);
            }
        } finally {
            await productPage.close();
        }
    }

    // // Loop through categories and subcategories
    for (const category of categories) {
        console.log(`\n🔍 Checking category: ${category.name}`);
        const categoryPage = await browser.newPage();
        await categoryPage.goto(category.url, { waitUntil: "domcontentloaded" });

        // Scroll a little so Zepto loads subcategory bar
        await categoryPage.evaluate(() => {
            window.scrollBy(0, 150);
        });
        await new Promise(res => setTimeout(res, 500));

        // Detect subcategories
        const subcategories = await categoryPage.$$eval(
            'div.no-scrollbar a',
            (links) => links.map(a => ({
                name: a.textContent.trim(),
                url: a.href,
                img: a.querySelector('img')?.src || ''
            }))
        );

        await categoryPage.close();

        if (subcategories.length > 0) {
            console.log(`📂 Found ${subcategories.length} subcategories in ${category.name}`);
            for (const sub of subcategories) {
                await scrapeProductGrid(sub.url, `${category.name} > ${sub.name}`);
            }
        } else {
            console.log(`📂 No subcategories, scraping ${category.name} directly`);
            await scrapeProductGrid(category.url, category.name);
        }
    }
    const filePath = path.join(__dirname, "data", "zepto_all_products.json");
    fs.writeFileSync(filePath, JSON.stringify(allProducts, null, 2));
    await browser.close();
    console.log("🎉 Zepto scraping complete!");
}

module.exports = scrapeZepto;
