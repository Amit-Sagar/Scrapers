const extractImageFromPDP = require("./extractImageFromPDP");

module.exports = async function productScraper(page, categoryName) {
    try {
        console.log(`\n📂 Scraping category: ${categoryName}`);

        // -------------------------
        // STEP 1: FULL PAGE SCROLL
        // -------------------------
        let prevHeight = 0;
        while (true) {
            const height = await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
                return document.body.scrollHeight;
            });

            await new Promise(r => setTimeout(r, 500));
            if (height === prevHeight) break;
            prevHeight = height;
        }

        // -------------------------
        // STEP 2: ALL PRODUCT CARDS
        // -------------------------
        const selector = '#plpContainer div[role="button"]';
        const cards = await page.$$(selector);

        console.log(`📌 Found ${cards.length} product cards`);

        const results = [];

        // -------------------------
        // STEP 3: LOOP EVERY CARD
        // -------------------------
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];

            // Scroll card into view (required for lazy loading)
            await card.evaluate(el => el.scrollIntoView({ block: "center" }));
            await new Promise(r => setTimeout(r, 300));

            // -------------------------
            // EXTRACT MAIN FIELDS
            // -------------------------
            const id = await card.evaluate(el => el.id || "");

            const name = await card.$eval(
                ".tw-text-300.tw-font-semibold",
                el => el.textContent.trim()
            ).catch(() => "");

            const quantity = await card.$eval(
                ".tw-text-200.tw-font-medium",
                el => el.textContent.trim()
            ).catch(() => "");

            const price = await card.$eval(
                ".tw-text-200.tw-font-semibold",
                el => el.textContent.trim()
            ).catch(() => "");

            // Skip if required fields missing
            if (!id || !name || !price) continue;

            // -------------------------
            // ETA (delivery time)
            // -------------------------
            const eta = await card.evaluate(() => {
                const etaEl = document.querySelector('[class*="tw-text-050 tw-font-bold tw-uppercase"]');
                return etaEl ? etaEl.textContent.trim() : "N/A";
            }).catch(() => "N/A");
           

            // -------------------------
            // IMAGE (List → PDP Fallback)
            // -------------------------
            let image = await extractListImage(card);

            // Fallback if missing
            if (!image || image === "N/A") {
                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                const deepLink = `https://blinkit.com/prn/${slug}/prid/${id}`;
                image = await extractImageFromPDP(page, deepLink);
            }

            if (!image) image = "N/A";

            // -------------------------
            // Deep link
            // -------------------------
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            const deepLink = `https://blinkit.com/prn/${slug}/prid/${id}`;

            // -------------------------
            // FINAL PRODUCT OBJECT
            // -------------------------
            results.push({
                id,
                name,
                quantity,
                price,
                eta,
                image,
                deepLink,
                category: categoryName,
                source: "blinkit"
            });
        }

        return results;

    } catch (err) {
        console.error("❌ productScraper error:", err);
        return [];
    }
};

// ------------------------------------------------------
// INTERNAL — Extract product list image (no SVG/icons)
// ------------------------------------------------------
async function extractListImage(card) {
    try {
        // 1️⃣ Direct <img> tags
        const imgHandles = await card.$$("img");

        for (let img of imgHandles) {
            const url = await img.evaluate(el => {
                const src =
                    el.src ||
                    el.getAttribute("data-src") ||
                    el.getAttribute("data-srcset") ||
                    "";

                if (!src) return null;

                // Reject icons + svg
                if (src.includes("eta-icons") || src.includes("icons") || src.endsWith(".svg")) {
                    return null;
                }

                // Accept only real images
                if (
                    src.includes("cloudinary") ||
                    src.includes("grofers") ||
                    src.includes("cms-assets") ||
                    src.includes("blinkit") ||
                    src.match(/\.(jpg|jpeg|png)$/)
                ) {
                    return src;
                }

                return null;
            });

            if (url) return url;
        }

        // 2️⃣ CSS background-image fallback
        const bgImage = await card.evaluate(() => {
            const nodes = document.querySelectorAll("*");
            for (let el of nodes) {
                const style = window.getComputedStyle(el);
                const bg = style.backgroundImage;

                if (bg && bg.includes("url(")) {
                    const match = bg.match(/url\(["']?(.*?)["']?\)/);
                    if (!match) continue;

                    const url = match[1];

                    if (
                        url.includes("svg") ||
                        url.includes("icon") ||
                        url.includes("eta-icons")
                    ) continue;

                    return url;
                }
            }
            return null;
        });

        return bgImage || "N/A";
    } catch {
        return "N/A";
    }
}







