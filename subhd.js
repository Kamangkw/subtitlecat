const subtitleSource = {
    manifest: {
        schema: 1,
        id: "subhd",
        name: "SubHD",
        version: "1.0.0",
        minimumHost: 1,
        domains: [
            "subhd.me",
            "subhd.one",
            "subhdtw.com",
            "subhd.top",
            "subhd.cc"
        ],
        languages: ["zh-TW", "zh-Hant", "zh", "en"],
        credentials: []
    },

    host: "https://subhd.me",

    clean: function (s) {
        return String(s || "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
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
        if (url.startsWith("//")) return "https:" + url;

        return this.host + "/" + url.replace(/^\/+/, "");
    },

    lang: function (s) {
        s = String(s || "").toLowerCase();

        if (/繁體|繁体|traditional|zh[-_]?tw|zh[-_]?hk|cht/.test(s))
            return "zh-TW";

        if (/簡體|简体|simplified|zh[-_]?cn|chs/.test(s))
            return "zh-CN";

        if (/简繁|繁简|雙語|双语|bilingual|zh[-_]?en/.test(s))
            return "zh";

        if (/中文|chinese/.test(s))
            return "zh";

        if (/english|英文/.test(s))
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
            throw new SubtitleError("failed", "SubHD 網路請求失敗");
        }

        if (!r || !r.ok) {
            throw SubtitleError.from(r, "SubHD 請求失敗");
        }

        const html = r.text || "";

        if (!html) {
            throw new SubtitleError("noResults", "SubHD 回傳空白頁");
        }

        if (/captcha|cloudflare|challenge-platform|access denied/i.test(html)) {
            throw new SubtitleError("blocked", "SubHD 網站可能正在驗證或阻擋請求");
        }

        return html;
    },

    search: async function (hint, context) {
        const title = String(hint.title || "").trim();

        if (!title) {
            throw new SubtitleError("noResults", "影片名稱為空");
        }

        let query = title;

        if (hint.year) query += " " + hint.year;

        if (hint.season != null && hint.episode != null) {
            query += " S" + String(hint.season).padStart(2, "0");
            query += "E" + String(hint.episode).padStart(2, "0");
        }

        const searchURL =
            this.host + "/search/" + encodeURIComponent(query);

        const html = await this.getHTML(searchURL);

        const results = [];
        const seen = {};

        // 抽取字幕詳情連結
        const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
        let m;

        while ((m = hrefRe.exec(html)) !== null) {
            const href = m[1];

            // SubHD 常見字幕詳情頁路徑
            if (!/\/sub\/\d+/i.test(href) &&
                !/\/subtitle\/\d+/i.test(href)) {
                continue;
            }

            const url = this.abs(href);

            if (seen[url]) continue;
            seen[url] = true;

            // 取所在 HTML 區塊文字，作為候選名稱
            let titleText = "";

            const pos = html.indexOf(href);
            if (pos >= 0) {
                titleText = html.substring(
                    Math.max(0, pos - 250),
                    Math.min(html.length, pos + 600)
                );
            }

            titleText = this.clean(titleText);

            results.push({
                id: url,
                title: titleText || query,
                url: url,
                language: this.lang(titleText),
                format: "srt",
                forced: false,
                hearingImpaired: false,
                downloads: [],
                token: {
                    detailURL: url
                }
            });
        }

        if (!results.length) {
            throw new SubtitleError(
                "noResults",
                "SubHD 搜尋未找到可識別的字幕結果"
            );
        }

        return results.slice(0, 30);
    },

    resolve: async function (candidate, context) {
        const detailURL =
            (candidate.token && candidate.token.detailURL) ||
            candidate.url ||
            candidate.id;

        if (!detailURL) {
            throw new SubtitleError("incompatible", "字幕詳情網址不存在");
        }

        const html = await this.getHTML(detailURL);

        const files = [];
        const seen = {};

        // 提取字幕下載連結
        const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
        let m;

        while ((m = hrefRe.exec(html)) !== null) {
            const href = m[1];

            if (!/\.(srt|ass|ssa|vtt)(?:[?#]|$)/i.test(href)) {
                continue;
            }

            const url = this.abs(href);

            if (seen[url]) continue;
            seen[url] = true;

            files.push({
                url: url,
                name: href.split("/").pop() || "SubHD Subtitle",
                language: this.lang(href),
                format: (href.match(/\.(srt|ass|ssa|vtt)/i) || [])[1] || "srt"
            });
        }

        if (!files.length) {
            throw new SubtitleError(
                "downloadFailed",
                "SubHD 詳情頁未找到直接字幕連結"
            );
        }

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
            name: f.name || candidate.title || "SubHD",
            format: f.format || "srt"
        };
    }
};