
const subtitleSource = {
  manifest: {
    schema: 1,
    id: "subhd",
    name: "SubHD",
    version: "3.0.0",
    minimumHost: 1,
    
domains: [
  "subhd.me",
  "subhdtw.com",
  "subhd.one",
  "subhd.top",
  "subhd.cc",
  "subhd.tv",
  "subhd.com"
],
    languages: ["zh-TW", "zh-Hans", "zh", "en"],
    credentials: []
  },

  host: "https://subhd.me",

  clean: function(s) {
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

  abs: function(u) {
    if (!u) return "";
    u = u.trim();
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("http")) return u;
    if (u.startsWith("/")) return this.host + u;
    return this.host + "/" + u;
  },

  
getHTML: async function(url) {
  try {
    const r = await $http.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",
        "Accept": "text/html,application/xhtml+xml"
      },
      timeout: 20000
    });

    if (!r || !r.data) {
      throw new Error("HTTP 沒有回傳網頁內容");
    }

    const html = String(r.data);

    if (/captcha|cloudflare|access denied|人机验证|安全验证/i.test(html) &&
        html.length < 100000) {
      throw new Error("收到網站驗證頁，並非搜尋結果");
    }

    return html;

  } catch (e) {
    const detail = String(e && e.message ? e.message : e);

    throw new Error(
      "SubHD 診斷：" + detail +
      " | 請求網址：" + url
    );
  }
},


  search: async function(hint, context) {
    const title = String(hint.title || "").trim();
    if (!title) return [];

    let query = title;
    if (hint.year) query += " " + hint.year;
    if (hint.season && hint.episode) {
      query += " S" + String(hint.season).padStart(2, "0") +
               "E" + String(hint.episode).padStart(2, "0");
    }

    const url = this.host + "/search/" + encodeURIComponent(query);
    const html = await this.getHTML(url);

    const results = [];
    const seen = {};

    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;

    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      const titleText = this.clean(m[2]);

      if (!titleText || titleText.length < 3) continue;
      if (/^(首页|登录|注册|搜索|下载|论坛|帮助|更多|下一页|上一页)$/i.test(titleText)) continue;
      if (/javascript:|mailto:/i.test(href)) continue;
      if (/\.srt$|\.ass$|\.ssa$|\.vtt$/i.test(href)) continue;

      const fullURL = this.abs(href);

      if (!/subhd/i.test(fullURL)) continue;
      if (seen[fullURL]) continue;
      seen[fullURL] = true;

      results.push({
        id: fullURL,
        title: titleText,
        language: "zh",
        format: "srt",
        url: fullURL
      });
    }

    return results.slice(0, 40);
  },

  resolve: async function(candidate, context) {
    const detailURL = candidate.url || candidate.id;
    if (!detailURL) throw new Error("缺少字幕詳情頁網址");

    const html = await this.getHTML(detailURL);

    const links = [];
    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;

    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      const text = this.clean(m[2]);
      const fullURL = this.abs(href);

      if (/\.(srt|ass|ssa|vtt)(?:\?|$)/i.test(fullURL)) {
        links.push({
          url: fullURL,
          text: text,
          format: (fullURL.match(/\.(srt|ass|ssa|vtt)/i) || ["", "srt"])[1]
        });
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

    throw new Error("詳情頁未找到直接字幕下載連結");
  }
};
