const client = require('../elastic/elasticClient');
const slugify = require('slugify');
const generateProductId = require('../utils/helper');

async function saveProducts(products, source) {
    if (!Array.isArray(products) || products.length === 0) {
        console.log(`⚠️ No products to save for ${source}`);
        return;
    }
    for (const doc of products) {
        try {
            const productId = generateProductId(doc.name, doc.quantity || "na");

            await client.update({
                index: "products",
                id: productId,
                script: {
                    source: `
                        if (ctx._source.platforms == null) {
                          ctx._source.platforms = [];
                        }
                        def found = false;
                        for (p in ctx._source.platforms) {
                          if (p.name == params.platform.name) {
                            p.price = params.platform.price;
                            p.brand = params.platform.brand;
                            p.url = params.platform.url;
                            p.image = params.platform.image;
                            found = true;
                          }
                        }
                        if (!found) {
                          ctx._source.platforms.add(params.platform);
                        }
                        ctx._source.updatedAt = params.updatedAt;
                        ctx._source.category = params.category;
                        ctx._source.name = params.name;
                        ctx._source.quantity = params.quantity; 
                    `,
                    params: {
                        platform: {
                            name: source,
                            price: doc.price,
                            brand: doc.brand || null,
                            url: doc.deepLink || null,
                            image: doc.image || null
                        },
                        updatedAt: new Date().toISOString(),
                        category: doc.category,
                        name: doc.name,
                        quantity: doc.quantity
                    }
                },
                upsert: {
                    id: productId,
                    name: doc.name,
                    quantity: doc.quantity,
                    category: doc.category,
                    updatedAt: new Date().toISOString(),
                    platforms: [
                        {
                            name: source,
                            price: doc.price,
                            brand: doc.brand || null,
                            url: doc.deeplink || null,
                            image: doc.image || null
                        }
                    ]
                }
            });

        } catch (err) {
            console.error(`❌ Failed to save product ${doc.name} (${source}):`, err);
        }
    }

    console.log(`✅ Processed ${products.length} ${source} products`);
}

module.exports = saveProducts;
