const subtitleSource = {
  manifest: {
    schema: 1,
    id: "subhd",
    name: "SubHD",
    version: "3.1.0",
    minimumHost: 1,
    domains: [
      "subhd.me",
      "subhd.tv",
      "subhd.com",
      "subhd.one",
      "subhd.top",
      "subhd.cc",
      "subhdtw.com"
    ],
    languages: ["zh-TW", "zh-Hans", "zh", "en"],
    credentials: []
  },

  host: "https://subhd.me",

  // 備援網域:主網域失敗(無內容 / 4xx / 5xx / 驗證頁)時依序嘗試
  hosts: [
    "https://subhd.me",
    "https://subhd.tv",
    "https://subhd.com",
    "https://subhd.one",
    "https://subhd.top",
    "https://subhd.cc",
    "https://subhdtw.com"
  ],

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

  abs: function (u) {
    if (!u) return "";
    u = u.trim();
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("http")) return u;
    if (u.startsWith("/")) return this.host + u;
    return this.host + "/" + u;
  },

  pathOf: function (url) {
    return String(url).replace(/^https?:\/\/[^\/]+/i, "") || "/";
  },

  isSubhdURL: function (url) {
    return /^https?:\/\/([^\/]+\.)?subhd[^\/]*\//i.test(url);
  },

  getHTML: async function (url) {
    const path = this.pathOf(url);
    const hosts = [this.host].concat(this.hosts.filter(h => h !== this.host));
    const errors = [];

    for (const host of hosts) {
      try {
        const r = await $http.get(host + path, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            "Referer": host + "/"
          },
          timeout: 20000
        });

        const status = r && (r.status || r.statusCode);
        if (status && status >= 400) throw new Error("HTTP " + status);

        // 相容不同 $http 回傳格式
        let body = null;
        if (typeof r === "string") body = r;
        else if (r) body = r.data != null ? r.data : (r.body != null ? r.body : r.text);

        if (body == null || String(body).trim() === "") {
          throw new Error("HTTP 沒有回傳網頁內容" + (status ? "(狀態 " + status + ")" : ""));
        }

        const html = typeof body === "string" ? body : String(body);

        if (/captcha|cloudflare|access denied|人机验证|安全验证|just a moment/i.test(html) &&
            html.length < 100000) {
          throw new Error("收到網站驗證頁,並非搜尋結果");
        }

        this.host = host; // 記住可用網域
        return html;
      } catch (e) {
        errors.push(host.replace("https://", "") + ":" + String(e && e.message ? e.message : e));
      }
    }

    throw new Error("SubHD 診斷:所有網域皆失敗 | " + errors.join(" ; ") + " | 路徑:" + path);
  },

  search: async function (hint, context) {
    const title = String(hint.title || "").trim();
    if (!title) return [];

    let query = title;
    if (hint.year) query += " " + hint.year;
    if (hint.season && hint.episode) {
      query += " S" + String(hint.season).padStart(2, "0") +
               "E" + String(hint.episode).padStart(2, "0");
    }

    const html = await this.getHTML(this.host + "/search/" + encodeURIComponent(query));

    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const detail = [];
    const generic = [];
    const seen = {};
    const tokens = title.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    let m;

    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      const titleText = this.clean(m[2]);

      if (!titleText || titleText.length < 3) continue;
      if (/^(首页|首頁|登录|登入|注册|註冊|搜索|搜尋|下载|下載|论坛|論壇|帮助|幫助|更多|下一页|下一頁|上一页|上一頁)$/i.test(titleText)) continue;
      if (/^(javascript:|mailto:|#)/i.test(href)) continue;
      if (/\.(srt|ass|ssa|vtt)$/i.test(href)) continue;

      const fullURL = this.abs(href);
      if (!this.isSubhdURL(fullURL)) continue;
      if (seen[fullURL]) continue;

      // 相關度過濾:連結文字或其後 500 字內必須包含搜尋字詞,排除熱門推薦與導覽連結
      const nearby = (titleText + " " + this.clean(html.substr(m.index, 500))).toLowerCase();
      if (tokens.length && !tokens.every(t => nearby.indexOf(t) !== -1)) continue;

      seen[fullURL] = true;

      const item = {
        id: fullURL,
        title: titleText,
        language: "zh",
        format: "srt",
        url: fullURL
      };

      // 字幕詳情頁通常含數字 ID(如 /detail/123456 或 /ar0/123456)
      if (/\/(detail|ar0|sub|zimu)\/\w+/i.test(fullURL) || /\/\d{4,}(?:[\/?#]|$)/.test(fullURL)) {
        detail.push(item);
      } else {
        generic.push(item);
      }
    }

    // 優先回傳詳情頁連結,避免導覽列連結混入結果
    return (detail.length ? detail : generic).slice(0, 40);
  },

  resolve: async function (candidate, context) {
    const detailURL = candidate.url || candidate.id;
    if (!detailURL) throw new Error("缺少字幕詳情頁網址");

    const html = await this.getHTML(detailURL);

    const links = [];
    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;

    while ((m = re.exec(html)) !== null) {
      const fullURL = this.abs(m[1]);
      const ext = fullURL.match(/\.(srt|ass|ssa|vtt)(?:\?|$)/i);
      if (ext) {
        links.push({ url: fullURL, text: this.clean(m[2]), format: ext[1].toLowerCase() });
      }
    }

    if (links.length) {
      return {
        url: links[0].url,
        name: candidate.title || "SubHD",
        format: links[0].format
      };
    }

    const downloadMatch = html.match(
      /href\s*=\s*["']([^"']*(?:download|down)[^"']*)["']/i
    );

    if (downloadMatch) {
      return {
        url: this.abs(downloadMatch[1]),
        name: candidate.title || "SubHD",
        format: "srt"
      };
    }

    throw new Error("詳情頁未找到直接字幕下載連結(SubHD 多為壓縮包/需驗證下載)");
  }
};
