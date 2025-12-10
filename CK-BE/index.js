const cron = require("node-cron");
const scrapeBlinkit = require("./scrapers/blinkitScraper");
const scrapeZepto = require("./scrapers/zeptoScraper");
const express = require("express");
const client = require("./elastic/elasticClient");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());

// 🔹 API Routes

app.get("/api/products", async (req, res) => {
    try {
        const response = await client.search({
            index: "products",
            size: 5000,
            body: {
                query: { match_all: {} },
                sort: [{ "updatedAt": { order: "desc" } }]
            }
        });
        const hits = response.hits.hits.map(hit => hit._source);
        res.json(hits);
    } catch (err) {
        console.error("❌ Error fetching products:", err.message);
        res.status(500).json({ error: "Failed to fetch products" });
    }
});

// Search products
app.get("/api/products/search", async (req, res) => {
    try {
        const { q, category } = req.query;
        let must = [];
        if (q) must.push({ match: { name: q } });
        if (category) must.push({ match: { category } });

        const response = await client.search({
            index: "products",
            size: 5000,
            body: {
                query: must.length ? { bool: { must } } : { match_all: {} }
            }
        });
        const hits = response.hits.hits.map(hit => hit._source);
        res.json(hits);
    } catch (err) {
        console.error("❌ Error searching products:", err.message);
        res.status(500).json({ error: "Failed to search products" });
    }
});

async function runScrapers() {
    console.log("🚀 Starting grocery scrapers...");

    try {
        await scrapeBlinkit();
        await scrapeZepto();
        console.log("✅ Scraping finished.");
    } catch (err) {
        console.error("❌ Error while scraping:", err);
    }
}

// Run immediately once when server starts
runScrapers();

// Schedule: run every day at 2 AM
cron.schedule("0 2 * * *", () => {
    console.log("⏰ Running scheduled scraper (2 AM)...");
    runScrapers();
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("✅ Server running on port 4000");
});
