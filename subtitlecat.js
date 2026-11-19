var rule = {
  title: 'SubtitleCat 字幕',
  host: 'https://www.subtitlecat.com',
  homeUrl: '/index.php?search=',
  url: '/index.php?search=fy',
  searchUrl: '/index.php?search=**',
  searchable: 1,
  quickSearch: 1,
  filter: 0,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  },
  
  // 搜尋字幕
  searchContent: function(key, quick, pg) {
    var url = this.host + '/index.php?search=' + encodeURIComponent(key);
    var html = request(url, {
      headers: this.headers
    });
    
    var list = [];
    var re = /href=["']((?:\/)?subs\/[^"']+\.html?)["'][^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    
    while ((m = re.exec(html)) !== null) {
      var link = m[1];
      var name = m[2]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim();
      
      if (!name) continue;
      
      if (link.indexOf('http') !== 0) {
        link = this.host + (link.charAt(0) === '/' ? '' : '/') + link;
      }
      
      list.push({
        vod_id: link,
        vod_name: name,
        vod_pic: '',
        vod_remarks: 'SubtitleCat'
      });
    }
    
    // 去重
    var seen = {};
    list = list.filter(function(item) {
      if (seen[item.vod_id]) return false;
      seen[item.vod_id] = true;
      return true;
    });
    
    return JSON.stringify({
      list: list
    });
  },
  
  // 詳情頁：提取各語言字幕
  detailContent: function(ids) {
    var id = ids[0];
    var html = request(id, {
      headers: this.headers
    });
    
    var list = [];
    var re = /href=["']([^"']+\.srt(?:\?[^"']*)?)["'][^>]*>/gi;
    var m;
    
    while ((m = re.exec(html)) !== null) {
      var link = m[1];
      
      if (link.indexOf('http') !== 0) {
        link = this.host + (link.charAt(0) === '/' ? '' : '/') + link;
      }
      
      var lang = link.match(/[-_]([a-z]{2,3}(?:-[a-z]{2})?)\.srt/i);
      var name = lang ? lang[1].toUpperCase() : '字幕檔';
      
      list.push({
        name: name,
        url: link
      });
    }
    
    // 解析頁面中的語言下載按鈕
    var btnRe = /id=["']download_([a-z]+)["'][\s\S]*?href=["']([^"']+\.srt[^"']*)["']/gi;
    while ((m = btnRe.exec(html)) !== null) {
      var code = m[1];
      var link2 = m[2];
      
      if (link2.indexOf('http') !== 0) {
        link2 = this.host + (link2.charAt(0) === '/' ? '' : '/') + link2;
      }
      
      var exists = list.some(function(x) {
        return x.url === link2;
      });
      
      if (!exists) {
        list.push({
          name: code.toUpperCase(),
          url: link2
        });
      }
    }
    
    var seen = {};
    list = list.filter(function(x) {
      if (seen[x.url]) return false;
      seen[x.url] = true;
      return true;
    });
    
    var vod = {
      vod_id: id,
      vod_name: 'SubtitleCat 字幕下載',
      vod_pic: '',
      vod_content: '選擇字幕語言下載',
      vod_play_from: '字幕下載',
      vod_play_url: list.map(function(x) {
        return x.name + '$' + x.url;
      }).join('#')
    };
    
    return JSON.stringify({
      list: [vod]
    });
  },
  
  // 將字幕下載網址交給播放器/來源播放解析
  playerContent: function(flag, id, vip) {
    return JSON.stringify({
      parse: 0,
      url: id,
      header: this.headers
    });
  }
};