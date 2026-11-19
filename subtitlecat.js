const subtitleSource = {
    manifest: {
        schema: 1,
        id: "subtitlecat",
        name: "SubtitleCat",
        version: "2.0.0",
        minimumHost: 1,
        domains: ["subtitlecat.com", "www.subtitlecat.com"],
        languages: ["zh-TW", "zh-Hant", "zh", "en"],
        credentials: []
    },

    base: "https://www.subtitlecat.com",

    clean: function (s) {
        return String(s || "")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, " ")
            .trim();
    },

    abs: function (url) {
        if (!url) return "";
        url = String(url).trim();

        if (/^https?:\/\//i.test(url)) return url;
        if (url.indexOf("//") === 0) return "https:" + url;

        return this.base + "/" + url.replace(/^\/+/, "");
    },

    lang: function (s) {
        s = String(s || "").toLowerCase();

        if (/zh[-_]?tw|zh[-_]?hk|cht|traditional|繁體|繁体/.test(s))
            return "zh-TW";

        if (/zh[-_]?cn|chs|simplified|简体|簡體/.test(s))
            return "zh-CN";

        if (/chinese|中文|mandarin/.test(s))
            return "zh";

        if (/english|eng|en[-_]/.test(s))
            return "en";

        return "";
    },

    getHTML: async function (url) {
        let r;

        try {
            r = await $http.get(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
                },
                timeout: 15000
            });
        } catch (e) {
            throw new SubtitleError("failed", "SubtitleCat 網路請求失敗");
        }

        if (!r || !r.ok) {
            throw SubtitleError.from(r, "SubtitleCat 網頁請求失敗");
        }

        let html = r.text || "";

        if (!html) {
            throw new SubtitleError("noResults", "網站回傳空白頁");
        }

        if (/cloudflare|captcha|just a moment|challenge-platform/i.test(html)) {
            throw new SubtitleError("blocked", "SubtitleCat 網站可能正在反爬或驗證");
        }

        return html;
    },

    search: async function (hint, context) {
        const title = String((hint && hint.title) || "").trim();

        if (!title) {
            throw new SubtitleError("noResults", "影片名稱是空白");
        }

        let query = title;

        if (hint.year) query += " " + hint.year;

        if (hint.season != null && hint.episode != null) {
            query += " S" + String(hint.season).padStart(2, "0");
            query += "E" + String(hint.episode).padStart(2, "0");
        }

        const searchURL =
            this.base + "/index.php?search=" + encodeURIComponent(query);

        const html = await this.getHTML(searchURL);

        const results = [];
        const seen = {};

        // 抽取 href 屬性，避免依賴完整 Anchor 結構
        const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
        let m;

        while ((m = hrefRe.exec(html)) !== null) {
            const href = m[1];

            // 支援 subs/xxx、/subs/xxx、絕對網址
            if (!/(?:^|\/)subs\/[^"'<>]+\.html?(?:[?#]|$)/i.test(href)) {
                continue;
            }

            const detailURL = this.abs(href);

            if (seen[detailURL]) continue;
            seen[detailURL] = true;

            // 從網址推導檔名
            let fileName = href.split("/").pop() || "";
            fileName = fileName.replace(/\.html?$/i, "");

            fileName = fileName
                .replace(/%20/g, " ")
                .replace(/%2E/gi, ".")
                .replace(/%28/g, "(")
                .replace(/%29/g, ")");

            results.push({
                id: detailURL,
                key: detailURL,
                title: fileName || title,
                url: detailURL,
                language: "",
                format: "srt",
                forced: false,
                hearingImpaired: false,
                downloads: [],
                token: {
                    detailURL: detailURL
                }
            });
        }

        if (!results.length) {
            throw new SubtitleError(
                "noResults",
                "搜尋頁沒有辨識到字幕結果；可能是網站改版或反爬"
            );
        }

        return results.slice(0, 20);
    },

    resolve: async function (candidate, context) {
        const detailURL =
            (candidate && candidate.token &&
                candidate.token.detailURL) ||
            candidate.url ||
            candidate.id;

        if (!detailURL) {
            throw new SubtitleError("incompatible", "缺少字幕詳情網址");
        }

        const html = await this.getHTML(detailURL);
        const files = [];
        const seen = {};

        // 第一優先：SubtitleCat 的下載按鈕
        const downloadRe =
            /id\s*=\s*["']download_([a-z0-9_-]+)["'][^>]*href\s*=\s*["']([^"']+)["']/gi;

        let m;

        while ((m = downloadRe.exec(html)) !== null) {
            const code = m[1];
            const href = m[2];

            if (!/\.srt(?:[?#]|$)/i.test(href)) continue;

            const url = this.abs(href);

            if (seen[url]) continue;
            seen[url] = true;

            files.push({
                url: url,
                language: this.lang(code + " " + href),
                name: code.toUpperCase(),
                format: "srt"
            });
        }

        // 第二優先：直接抽取 SRT 網址
        if (!files.length) {
            const hrefRe = /href\s*=\s*["']([^"']+\.srt(?:\?[^"']*)?)["']/gi;

            while ((m = hrefRe.exec(html)) !== null) {
                const href = m[1];
                const url = this.abs(href);

                if (seen[url]) continue;
                seen[url] = true;

                files.push({
                    url: url,
                    language: this.lang(href),
                    name: href.split("/").pop() || "Subtitle",
                    format: "srt"
                });
            }
        }

        if (!files.length) {
            throw new SubtitleError(
                "downloadFailed",
                "字幕詳情頁沒有找到 SRT 下載網址"
            );
        }

        // 繁體中文優先
        files.sort(function (a, b) {
            function score(x) {
                if (x.language === "zh-TW") return 100;
                if (x.language === "zh") return 80;
                if (x.language === "zh-CN") return 60;
                if (x.language === "en") return 30;
                return 0;
            }

            return score(b) - score(a);
        });

        const f = files[0];

        return {
            url: f.url,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Referer": detailURL
            },
            name: f.name || candidate.title || "SubtitleCat",
            format: f.format || "srt"
        };
    }
};