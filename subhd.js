const subtitleSource = {
  manifest: {
    schema: 1,
    id: "thunder",
    name: "Thunder 迅雷",
    version: "1.0.0",
    minimumHost: 1,
    domains: [
      "api-shoulei-ssl.xunlei.com",
      "subtitle.v.geilijiasu.com",
      "subtitle.kankan.xunlei.com"
    ],
    languages: ["zh-Hans", "zh-TW", "zh", "en"],
    credentials: []
  },

  // 注意:此介面網址與欄位名依公開資料推測,未能在撰寫時驗證。
  // 若失敗,錯誤訊息會附上回應內容開頭,可據此調整。
  api: "https://api-shoulei-ssl.xunlei.com/oracle/subtitle",

  headers: {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept": "application/json, text/plain, */*"
  },

  SUB_EXT: /^(srt|ass|ssa|vtt|sub)$/i,

  clean: function (s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  },

  // 將迅雷回傳的語言標示轉成 App 用的語言代碼
  langCode: function (langs) {
    const text = [].concat(langs || []).join(",");
    if (/繁|cht|zh-?tw|zh-?hk|big5/i.test(text)) return "zh-TW";
    if (/简|簡|chs|zh-?cn|zh-?hans|中文|chinese/i.test(text)) return "zh-Hans";
    if (/英|eng|en/i.test(text)) return "en";
    return "zh";
  },

  getJSON: async function (url) {
    const r = await $http.get(url, { headers: this.headers, timeout: 20000 });

    const status = r && (r.status || r.statusCode);
    if (status && status >= 400) throw new Error("HTTP " + status);

    let body = null;
    if (typeof r === "string") body = r;
    else if (r) body = r.data != null ? r.data : (r.body != null ? r.body : r.text);

    if (body == null || (typeof body === "string" && body.trim() === "")) {
      throw new Error("HTTP 沒有回傳內容" + (status ? "(狀態 " + status + ")" : ""));
    }

    if (typeof body === "object") return body;

    try {
      return JSON.parse(String(body));
    } catch (e) {
      throw new Error("回應不是 JSON | 開頭:" + this.clean(String(body)).slice(0, 100));
    }
  },

  search: async function (hint, context) {
    const title = String(hint.title || "").trim();
    if (!title) return [];

    // 迅雷以片名/檔名模糊比對:電影用「片名」,劇集加上 SxxExx
    let query = title;
    if (hint.season && hint.episode) {
      query += " S" + String(hint.season).padStart(2, "0") +
               "E" + String(hint.episode).padStart(2, "0");
    }

    const url = this.api + "?name=" + encodeURIComponent(query);

    let json;
    try {
      json = await this.getJSON(url);
    } catch (e) {
      throw new Error("迅雷 診斷:" + String(e && e.message ? e.message : e) + " | 請求網址:" + url);
    }

    const list = Array.isArray(json && json.data) ? json.data : null;
    if (!list) {
      throw new Error(
        "迅雷 診斷:回應格式不符(找不到 data 陣列)| code=" +
        (json && json.code) + " | 內容開頭:" +
        this.clean(JSON.stringify(json)).slice(0, 120)
      );
    }

    const tokens = title.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const results = [];
    const seen = {};

    for (const it of list) {
      const link = it && (it.url || it.surl);
      if (!link) continue;

      const ext = String(it.ext || (String(link).match(/\.(\w{2,4})(?:\?|$)/) || [])[1] || "srt");
      if (!this.SUB_EXT.test(ext)) continue;

      const name = this.clean(it.name || it.extra_name || "");
      if (!name) continue;

      // 相關度過濾:名稱需包含搜尋字詞,避免模糊比對帶入無關字幕
      if (tokens.length && !tokens.every(t => name.toLowerCase().indexOf(t) !== -1)) continue;

      if (seen[link]) continue;
      seen[link] = true;

      results.push({
        id: String(link),
        title: name,
        language: this.langCode(it.languages),
        format: ext.toLowerCase(),
        url: String(link)
      });
    }

    // 中文字幕優先
    const rank = c => (c.language === "zh-Hans" ? 0 : c.language === "zh-TW" ? 1 : c.language === "zh" ? 2 : 3);
    results.sort((a, b) => rank(a) - rank(b));

    return results.slice(0, 40);
  },

  // 迅雷的結果本身就是直接的字幕檔連結,不需要再解析詳情頁
  resolve: async function (candidate, context) {
    const url = candidate.url || candidate.id;
    if (!url) throw new Error("缺少字幕下載網址");

    return {
      url: url,
      name: candidate.title || "Thunder",
      format: candidate.format || "srt"
    };
  }
};
