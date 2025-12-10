module.exports = async function extractImageFromPDP(page, url) {
    try {
        if (!url) return null;

        console.log("🔎 Opening PDP →", url);

        const newPage = await page.browser().newPage();

        await newPage.goto(url, {
            waitUntil: "networkidle2",
            timeout: 60000
        });

        // scroll to load images
        await newPage.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight / 2);
        });

        await new Promise(res => setTimeout(res, 800));

        // Evaluate image extraction inside PDP
        const image = await newPage.evaluate(() => {
            const urlValidators = (url) => {
                if (!url) return false;
                return (
                    url.includes("cloudinary") ||
                    url.includes("grofers") ||
                    url.includes("blinkit") ||
                    url.includes("cms-assets") ||
                    url.includes(".jpg") ||
                    url.includes(".jpeg") ||
                    url.includes(".png") ||
                    url.includes("product") ||
                    url.includes("image")
                );
            };

            // 1️⃣ Direct IMG tags
            const imgs = Array.from(document.querySelectorAll("img"));
            for (let img of imgs) {
                const src =
                    img.src ||
                    img.getAttribute("data-src") ||
                    img.getAttribute("data-srcset");

                if (urlValidators(src)) return src;
            }

            // 2️⃣ Background-image
            const all = document.querySelectorAll("*");
            for (let el of all) {
                const style = window.getComputedStyle(el);
                const bg = style.backgroundImage;
                if (bg && bg.includes("url(")) {
                    const match = bg.match(/url\(["']?(.*?)["']?\)/);
                    if (match && urlValidators(match[1])) {
                        return match[1];
                    }
                }
            }

            // 3️⃣ Meta tags (rare but Blinkit sometimes uses)
            const metaImg =
                document.querySelector('meta[property="og:image"]')?.content ||
                document.querySelector('meta[name="twitter:image"]')?.content;

            if (urlValidators(metaImg)) return metaImg;

            // 4️⃣ Blinkit JSON inside <script>
            const scripts = Array.from(document.querySelectorAll("script"));
            for (let sc of scripts) {
                if (!sc.innerText) continue;
                if (sc.innerText.includes("image") || sc.innerText.includes("cloudinary")) {
                    const match = sc.innerText.match(/https?:\/\/[^"']+\.(jpg|jpeg|png)/);
                    if (match && urlValidators(match[0])) return match[0];
                }
            }

            return null; // no image found
        });

        await newPage.close();

        return image;

    } catch (err) {
        console.log("❌ extractImageFromPDP ERROR:", err);
        return null;
    }
};






