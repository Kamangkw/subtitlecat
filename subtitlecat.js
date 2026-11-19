// SubtitleCat - Yingxia Subtitle Source
// Protocol: Yingxia SubtitleProvider schema 1

const subtitleSource = {
    manifest: {
        schema: 1,
        id: "subtitlecat",
        name: "SubtitleCat",
        version: "1.0.1",
        minimumHost: 1,
        domains: [
            "www.subtitlecat.com",
            "subtitlecat.com"
        ],
        languages: [
            "zh-TW",
            "zh-Hant",
            "zh",
            "en"
        ],
        credentials: []
    },

    // ------------------------------------------
    // 工具：文字清理
    // ------------------------------------------
    cleanText: function (s) {
        return String(s || "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&#(\d+);/g, function (_, n) {
                return String.fromCharCode(Number(n));
            })
            .replace(/\s+/g, " ")
            .trim();
    },

    // ------------------------------------------
    // 工具：網址補全
    // ------------------------------------------
    absoluteURL: function (url) {
        if (!url) return "";
        url = String(url).trim();

        if (/^https?:\/\//i.test(url)) return url;
        if (url.indexOf("//") === 0) return "https:" + url;

        return "https://www.subtitlecat.com" +
            (url.charAt(0) === "/" ? url : "/" + url);
    },

    // ------------------------------------------
    // 工具：語言判斷
    // ------------------------------------------
    languageFromText: function (text) {
        text = String(text || "").toLowerCase();

        if (/traditional|繁體|繁体|zh[-_]?tw|zh[-_]?hk|cht/.test(text)) {
            return "zh-TW";
        }

        if (/simplified|简体|簡體|zh[-_]?cn|chs/.test(text)) {
            return "zh-CN";
        }

        if (/chinese|中文|mandarin|zh/.test(text)) {
            return "zh";
        }

        if (/english|eng|en[-_]/.test(text)) {
            return "en";
        }

        return "";
    },

    // ------------------------------------------
    // 搜尋
    // ------------------------------------------
    search: async function (hint, context) {
        const title = (hint && hint.title) || "";
        const year = (hint && hint.year) || "";

        if (!title.trim()) {
            throw new SubtitleError("noResults", "沒有提供影片名稱");
        }

        let query = title.trim();

        // 加上年份，提高電影搜尋精度
        if (year) query += " " + year;

        const url =
            "https://www.subtitlecat.com/index.php?search=" +
            encodeURIComponent(query);

        let response;

        try {
            response = await $http.get(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                },
                timeout: 8000
            });
        } catch (e) {
            throw new SubtitleError(
                "failed",
                "SubtitleCat 搜尋請求失敗"
            );
        }

        if (!response.ok) {
            throw SubtitleError.from(response, "搜尋失敗");
        }

        const html = response.text || "";
        const results = [];
        const seen = {};

        // 搜尋結果頁的字幕詳情連結
        const anchorRe =
            /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

        let m;

        while ((m = anchorRe.exec(html)) !== null) {
            const href = m[1];
            const rawTitle = m[2];

            // 只接受 SubtitleCat 字幕頁
            if (!/\/subs\//i.test(href)) continue;
            if (!/\.html?(?:[?#]|$)/i.test(href)) continue;

            const name = this.cleanText(rawTitle);

            if (!name || name.length < 2) continue;

            const detailURL = this.absoluteURL(href);

            if (seen[detailURL]) continue;
            seen[detailURL] = true;

            results.push({
                id: detailURL,
                title: name,
                url: detailURL,
                language: "",
                format: "srt",
                downloads: [],
                token: {
                    detailURL: detailURL
                }
            });
        }

        if (!results.length) {
            throw new SubtitleError(
                "noResults",
                "SubtitleCat 沒有找到字幕，或搜尋頁格式已變更"
            );
        }

        return results.slice(0, 20);
    },

    // ------------------------------------------
    // 解析字幕下載
    // ------------------------------------------
    resolve: async function (candidate, context) {
        const detailURL =
            (candidate && candidate.token &&
                candidate.token.detailURL) ||
            (candidate && candidate.url) ||
            (candidate && candidate.id);

        if (!detailURL) {
            throw new SubtitleError(
                "incompatible",
                "字幕結果沒有詳情頁網址"
            );
        }

        let response;

        try {
            response = await $http.get(detailURL, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    "Referer": "https://www.subtitlecat.com/"
                },
                timeout: 8000
            });
        } catch (e) {
            throw new SubtitleError(
                "downloadFailed",
                "字幕詳情頁請求失敗"
            );
        }

        if (!response.ok) {
            throw SubtitleError.from(response, "字幕頁解析失敗");
        }

        const html = response.text || "";
        const files = [];
        const seen = {};

        // 解析頁面上的字幕下載連結
        const anchorRe =
            /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

        let m;

        while ((m = anchorRe.exec(html)) !== null) {
            const href = m[1];
            const label = this.cleanText(m[2]);

            // SRT / VTT / ZIP
            if (!/\.(srt|vtt|zip)(?:[?#]|$)/i.test(href)) {
                continue;
            }

            const downloadURL = this.absoluteURL(href);

            if (seen[downloadURL]) continue;
            seen[downloadURL] = true;

            const lang = this.languageFromText(
                label + " " + href
            );

            files.push({
                url: downloadURL,
                name: label || "SubtitleCat Subtitle",
                language: lang,
                format: (href.match(/\.(srt|vtt|zip)/i) || [])[1] ||
                    "srt"
            });
        }

        if (!files.length) {
            throw new SubtitleError(
                "downloadFailed",
                "詳情頁沒有找到可用字幕下載連結"
            );
        }

        // 語言排序：繁體中文優先
        files.sort(function (a, b) {
            const score = function (x) {
                if (x.language === "zh-TW") return 100;
                if (x.language === "zh") return 80;
                if (x.language === "zh-CN") return 60;
                if (x.language === "en") return 30;
                return 0;
            };

            return score(b) - score(a);
        });

        const selected = files[0];

        return {
            url: selected.url,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Referer": detailURL
            },
            name: selected.name || candidate.title || "SubtitleCat",
            format: selected.format || "srt"
        };
    }
};