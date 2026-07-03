const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ========== 免费音乐API代理 ==========

// 网易云音乐搜索（通过公开API）
app.get('/api/search/netease', async (req, res) => {
  try {
    const { keyword, page = 1, limit = 20 } = req.query;
    const response = await axios.get('https://music.163.com/api/search/get', {
      params: {
        s: keyword,
        type: 1,
        limit: limit,
        offset: (page - 1) * limit
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com'
      },
      timeout: 10000
    });
    
    const songs = (response.data.result?.songs || []).map(song => ({
      id: song.id,
      name: song.name,
      artist: song.artists?.map(a => a.name).join(' / ') || '未知艺术家',
      album: song.album?.name || '',
      albumPic: song.album?.picUrl || '',
      duration: song.duration,
      platform: 'netease',
      platformUrl: `https://music.163.com/#/song?id=${song.id}`
    }));
    
    res.json({ success: true, data: songs, total: response.data.result?.songCount || 0 });
  } catch (error) {
    console.error('网易云搜索失败:', error.message);
    res.json({ success: false, data: [], message: '搜索失败' });
  }
});

// 酷我音乐搜索（使用 search.kuwo.cn 免cookie接口）
app.get('/api/search/kuwo', async (req, res) => {
  try {
    const { keyword, page = 1, limit = 20 } = req.query;
    const response = await axios.get('http://search.kuwo.cn/r.s', {
      params: {
        ft: 'music',
        rn: limit,
        pn: page - 1,
        encoding: 'utf8',
        all: keyword,
        vipver: '1',
        client: 'kt'
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const text = typeof response.data === 'string' ? response.data : String(response.data);
    const songs = parseKuwoSearch(text);
    
    res.json({ success: true, data: songs });
  } catch (error) {
    console.error('酷我搜索失败:', error.message);
    res.json({ success: false, data: [], message: '搜索失败' });
  }
});

// 酷我搜索结果解析
function parseKuwoSearch(text) {
  const lines = text.split('\n');
  const songs = [];
  let currentSong = {};
  for (const line of lines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx).trim();
    const value = line.substring(eqIdx + 1).trim();
    if (key === 'MUSICRID' && value) {
      if (currentSong.MUSICRID) {
        songs.push(formatKuwoSong(currentSong));
      }
      currentSong = { MUSICRID: value.replace('MUSIC_', '') };
    } else if (key && value) {
      currentSong[key] = value;
    }
  }
  if (currentSong.MUSICRID) songs.push(formatKuwoSong(currentSong));
  return songs;
}

function formatKuwoSong(s) {
  return {
    id: s.MUSICRID,
    name: s.SONGNAME || '未知',
    artist: s.ARTIST || s.AARTIST || '未知',
    album: s.ALBUM || '',
    albumPic: s.ALBUMID ? `https://img2.kuwo.cn/star/albumcover/300/${s.ALBUMID}.jpg` : '',
    duration: parseInt(s.DURATION || 0) * 1000,
    platform: 'kuwo',
    platformUrl: `https://www.kuwo.cn/play/detail/${s.MUSICRID}`
  };
}

// 聚合搜索（多平台）
app.get('/api/search/all', async (req, res) => {
  try {
    const { keyword, page = 1, platform: filterPlatform } = req.query;
    const results = [];
    
    // 网易云搜索
    if (!filterPlatform || filterPlatform === 'netease') {
    try {
      const resp = await axios.get('https://music.163.com/api/search/get', {
        params: { s: keyword, type: 1, limit: 15, offset: (page - 1) * 15 },
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com' },
        timeout: 8000
      });
      const songs = (resp.data.result?.songs || []).map(song => ({
        id: song.id,
        name: song.name,
        artist: song.artists?.map(a => a.name).join(' / ') || '未知',
        album: song.album?.name || '',
        albumPic: song.album?.picUrl || '',
        duration: song.duration,
        platform: 'netease',
        platformUrl: `https://music.163.com/#/song?id=${song.id}`
      }));
      results.push(...songs);
    } catch (e) { /* 忽略单个源失败 */ }
    }
    
    // 酷狗搜索
    if (!filterPlatform || filterPlatform === 'kugou') {
    try {
      const resp = await axios.get('https://mobiles.kugou.com/api/v3/search/song', {
        params: { keyword, page, pagesize: 15, format: 'json' },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000
      });
      const songs = (resp.data.data?.info || []).map(song => ({
        id: song.hash,
        name: song.songname,
        artist: song.singername || '未知',
        album: song.album_name || '',
        albumPic: song.trans_param?.union_cover?.replace('{size}', '300') || '',
        duration: song.duration * 1000 || 0,
        platform: 'kugou',
        platformUrl: `https://www.kugou.com/song/#hash=${song.hash}`
      }));
      results.push(...songs);
    } catch (e) { /* 忽略 */ }
    }
    
    // QQ音乐搜索
    if (!filterPlatform || filterPlatform === 'qq') {
    try {
      const resp = await axios.get('https://shc.y.qq.com/soso/fcgi-bin/client_search_cp', {
        params: { w: keyword, p: page, n: 15, format: 'json', inCharset: 'utf8', outCharset: 'utf8' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://y.qq.com', 'Accept': 'application/json' },
        timeout: 8000
      });
      const songs = (resp.data?.data?.song?.list || []).map(song => ({
        id: song.songmid,
        name: song.songname,
        artist: song.singer?.map(s => s.name).join(' / ') || '未知',
        album: song.albumname || '',
        albumPic: song.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.albummid}.jpg` : '',
        duration: song.interval * 1000 || 0,
        platform: 'qq',
        platformUrl: `https://y.qq.com/n/ryqq/songDetail/${song.songmid}`
      }));
      results.push(...songs);
    } catch (e) { /* 忽略 */ }
    }
    
    // 酷我搜索（使用 search.kuwo.cn 免cookie接口）
    if (!filterPlatform || filterPlatform === 'kuwo') {
    try {
      const resp = await axios.get('http://search.kuwo.cn/r.s', {
        params: { ft: 'music', rn: '15', pn: String(page - 1), encoding: 'utf8', all: keyword, vipver: '1', client: 'kt' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000
      });
      const text = typeof resp.data === 'string' ? resp.data : String(resp.data);
      const kuwoSongs = parseKuwoSearch(text);
      results.push(...kuwoSongs);
    } catch (e) { console.log('酷我搜索失败:', e.message); }
    }
    
    res.json({ success: true, data: results });
  } catch (error) {
    res.json({ success: false, data: [], message: '搜索失败' });
  }
});

// 统一播放接口 - 支持 query 参数和 path 参数
app.get('/api/play', async (req, res) => {
  const platform = req.query.platform;
  const id = req.query.id || '0'; // 允许没有id，用name搜索
  const quality = req.query.quality || 'standard';
  if (!platform) return res.json({ success: false, message: '参数缺失' });
  await handlePlay(platform, id, quality, res, req);
});

app.get('/api/play/:platform/:id', async (req, res) => {
  const { platform, id } = req.params;
  const { quality = 'standard' } = req.query;
  await handlePlay(platform, id, quality, res, req);
});

// LX音源播放接口（兼容ikun API格式）
// 支持参数: source (kw/wy/git), name (歌曲名+歌手), quality (128k/320k/flac)
app.get('/api/lx/play', async (req, res) => {
  const { source = 'kw', name = '', quality = '128k', songId = '' } = req.query;
  
  if (!name && !songId) {
    return res.json({ code: 500, message: '缺少歌曲信息' });
  }
  
  try {
    const keyword = name || songId;
    
    // 根据source选择对应的huibq平台
    const huibqPlatform = source === 'wy' ? 'wy' : (source === 'kg' ? 'kg' : 'kw');
    
    // 先尝试huibq API（支持 wy/kw/kg）
    if (huibqPlatform === 'wy' || huibqPlatform === 'kw' || huibqPlatform === 'kg') {
      // 搜索获取对应平台的ID
      let searchId = '';
      if (huibqPlatform === 'wy') {
        // 搜网易云获取ID
        try {
          const resp = await axios.get('https://music.163.com/api/search/get', {
            params: { s: keyword, type: 1, limit: 5, offset: 0 },
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com' },
            timeout: 8000
          });
          const songs = resp.data.result?.songs || [];
          if (songs.length > 0) searchId = String(songs[0].id);
        } catch (e) { /* 继续 */ }
      } else if (huibqPlatform === 'kg') {
        // 搜酷狗获取hash
        try {
          const resp = await axios.get('http://mobilecdn.kugou.com/api/v3/search/song', {
            params: { format: 'json', keyword, package: 0, page: 1, pagesize: 5 },
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10)' },
            timeout: 8000
          });
          const songs = resp?.data?.data?.info || [];
          if (songs.length > 0 && songs[0].hash) searchId = songs[0].hash;
        } catch (e) { /* 继续 */ }
      } else {
        // 搜酷我获取ID
        try {
          const searchResp = await axios.get('http://search.kuwo.cn/r.s', {
            params: { ft: 'music', rn: '5', pn: '0', encoding: 'utf8', all: keyword, vipver: '1', client: 'kt' },
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 8000
          });
          const text = typeof searchResp.data === 'string' ? searchResp.data : String(searchResp.data);
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('MUSICRID=')) {
              searchId = line.substring(9).trim();
              break;
            }
          }
        } catch (e) { /* 继续 */ }
      }
      
      // 尝试huibq API
      if (searchId) {
        try {
          const apiUrl = `https://lxmusicapi.onrender.com/url/${huibqPlatform}/${searchId}/${quality}`;
          const resp = await axios.get(apiUrl, {
            headers: { 'X-Request-Key': 'share-v3', 'User-Agent': 'lx-music-request/v1.2.0' },
            timeout: 10000,
            validateStatus: s => true
          });
          const body = resp.data;
          if (body && body.code === 0 && body.url && body.url.startsWith('http')) {
            return res.json({
              code: 200,
              url: body.url,
              source: `lx-${huibqPlatform}`,
              quality: quality,
              message: 'success',
              songName: name,
              artist: ''
            });
          }
        } catch (e) { /* 回退到酷我 */ }
      }
    }
    
    // 回退：酷我搜索 + antiserver 播放
    const searchResp = await axios.get('http://search.kuwo.cn/r.s', {
      params: { ft: 'music', rn: '5', pn: '0', encoding: 'utf8', all: keyword, vipver: '1', client: 'kt' },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    });
    const text = typeof searchResp.data === 'string' ? searchResp.data : String(searchResp.data);
    
    // 解析搜索结果
    const lines = text.split('\n');
    const songs = [];
    let currentSong = {};
    for (const line of lines) {
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.substring(0, eqIdx).trim();
      const value = line.substring(eqIdx + 1).trim();
      if (key === 'MUSICRID' && value) {
        if (currentSong.MUSICRID) songs.push({ ...currentSong });
        currentSong = { MUSICRID: value.replace('MUSIC_', '') };
      } else if (key && value) {
        currentSong[key] = value;
      }
    }
    if (currentSong.MUSICRID) songs.push(currentSong);
    
    // 尝试播放
    for (const song of songs) {
      if (!song.MUSICRID) continue;
      let playUrl = '';
      
      // 先尝试HQ高音质
      try {
        const hqResp = await axios.get('https://antiserver.kuwo.cn/anti.s', {
          params: { type: 'convert_url3', format: 'mp3', response: 'url', br: '320kmp3', rid: `MUSIC_${song.MUSICRID}` },
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kuwo.cn' },
          timeout: 10000,
          responseType: 'text'
        });
        const hqData = typeof hqResp.data === 'string' ? hqResp.data : String(hqResp.data);
        try { playUrl = JSON.parse(hqData).url || ''; } catch { playUrl = hqData.trim(); }
      } catch (e) { /* 继续 */ }
      
      // 回退标准音质
      if (!playUrl || !playUrl.startsWith('http')) {
        try {
          const antiResp = await axios.get('https://antiserver.kuwo.cn/anti.s', {
            params: { type: 'convert_url', format: 'mp3', response: 'url', rid: `MUSIC_${song.MUSICRID}` },
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kuwo.cn' },
            timeout: 10000,
            responseType: 'text'
          });
          playUrl = typeof antiResp.data === 'string' ? antiResp.data.trim() : '';
        } catch (e) { /* 继续 */ }
      }
      
      if (playUrl && playUrl.startsWith('http')) {
        return res.json({
          code: 200,
          url: playUrl,
          source: source,
          quality: quality,
          message: 'success',
          songName: song.SONGNAME || '',
          artist: song.ARTIST || ''
        });
      }
    }
    
    res.json({ code: 500, message: '未找到可用的播放链接' });
  } catch (error) {
    console.error('LX播放失败:', error.message);
    res.json({ code: 500, message: '服务器异常' });
  }
});

async function handlePlay(platform, id, quality, res, req) {
  const songName = req?.query?.name || ''; // 歌曲名称+歌手（用于跨平台搜索原曲）
  
  // ===== 辅助函数 =====
  
  // 通过酷我 antiserver 播放（直接ID）
  async function playViaKuwo(kuwoId) {
    // 先尝试获取HQ高音质（320k MP3）
    try {
      const hqResp = await axios.get('https://antiserver.kuwo.cn/anti.s', {
        params: { type: 'convert_url3', format: 'mp3', response: 'url', br: '320kmp3', rid: `MUSIC_${kuwoId}` },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.kuwo.cn' },
        timeout: 10000,
        responseType: 'text' // 强制文本响应，避免axios自动解析JSON
      });
      let hqUrl = '';
      const data = typeof hqResp.data === 'string' ? hqResp.data : String(hqResp.data);
      try {
        const parsed = JSON.parse(data);
        hqUrl = parsed.url || '';
      } catch {
        hqUrl = data.trim();
      }
      if (hqUrl && hqUrl.startsWith('http')) {
        return { success: true, url: hqUrl, quality: 'high', bitrate: 320, source: 'kuwo' };
      }
    } catch (e) { console.log('酷我HQ播放失败:', e.message); }
    
    // 回退到标准音质（128k MP3）
    try {
      const resp = await axios.get('https://antiserver.kuwo.cn/anti.s', {
        params: { type: 'convert_url', format: 'mp3', response: 'url', rid: `MUSIC_${kuwoId}` },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.kuwo.cn' },
        timeout: 10000,
        responseType: 'text'
      });
      let url = '';
      if (typeof resp.data === 'string') {
        url = resp.data.trim();
      } else if (resp.data && resp.data.url) {
        url = resp.data.url;
      }
      if (url && url.startsWith('http')) {
        return { success: true, url, quality: 'standard', bitrate: 128, source: 'kuwo' };
      }
    } catch (e) { console.log('酷我播放失败:', e.message); }
    return null;
  }
  
  // 在酷我搜索歌曲并播放（通过 search.kuwo.cn 搜索 + antiserver 播放）
  async function searchAndPlayKuwo(keyword) {
    try {
      const searchResp = await axios.get('http://search.kuwo.cn/r.s', {
        params: { ft: 'music', rn: '5', pn: '0', encoding: 'utf8', all: keyword, vipver: '1', client: 'kt' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000
      });
      const text = typeof searchResp.data === 'string' ? searchResp.data : String(searchResp.data);
      
      // 解析酷我搜索返回的 key=value 格式
      const lines = text.split('\n');
      const songs = [];
      let currentSong = {};
      for (const line of lines) {
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const key = line.substring(0, eqIdx).trim();
        const value = line.substring(eqIdx + 1).trim();
        if (key === 'MUSICRID' && value) {
          if (currentSong.MUSICRID) songs.push({ ...currentSong });
          currentSong = { MUSICRID: value.replace('MUSIC_', '') };
        } else if (key && value) {
          currentSong[key] = value;
        }
      }
      if (currentSong.MUSICRID) songs.push(currentSong);
      
      // 尝试播放每个搜索结果
      for (const song of songs) {
        if (song.MUSICRID) {
          const result = await playViaKuwo(song.MUSICRID);
          if (result) {
            result.source = 'kuwo-search';
            result.kuwoName = song.SONGNAME || '';
            result.kuwoArtist = song.ARTIST || '';
            return result;
          }
        }
      }
    } catch (e) { console.log('酷我搜索播放失败:', e.message); }
    return null;
  }
  
  // 验证网易云外链是否有效（备用）
  async function tryNeteaseUrl(neteaseId) {
    const directUrl = `https://music.163.com/song/media/outer/url?id=${neteaseId}.mp3`;
    try {
      const testResp = await axios.get(directUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://music.163.com' },
        timeout: 8000, maxRedirects: 5, responseType: 'stream'
      });
      const ct = testResp.headers['content-type'] || '';
      testResp.data.destroy();
      if (ct.includes('audio') || ct.includes('octet-stream')) {
        const location = testResp.request?.res?.responseUrl || directUrl;
        if (!location.includes('/404')) {
          return { success: true, url: location, quality: 'standard', bitrate: 128, source: 'netease-direct' };
        }
      }
    } catch (e) { /* 无效 */ }
    return null;
  }
  
  // SVIP音源播放（仅kw可用，来自洛雪SVIP音源 musicapi.haitangw.net）
  // kg/tx/wy API已失效，改用酷我antiserver作为通用播放源
  async function playViaSvip(platform, songId, quality = 'standard') {
    // 目前只有 kw 平台可用
    if (platform !== 'kw' || !songId) return null;
    const apiUrl = `https://musicapi.haitangw.net/music/kw.php?type=mp3&id=${songId}&level=${quality}`;
    try {
      const resp = await axios.head(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 5000, maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400
      });
      const finalUrl = resp.request?.res?.responseUrl || resp.request?.path || '';
      if (finalUrl && (finalUrl.includes('kuwo.cn') || finalUrl.includes('.mp3') || finalUrl.includes('.m4a'))) {
        const bitrate = quality === 'exhigh' ? 320 : 128;
        return { success: true, url: finalUrl, quality: quality === 'exhigh' ? 'high' : 'standard', bitrate, source: `svip-kw` };
      }
    } catch (e) { console.log(`SVIP kw 播放失败:`, e.message); }
    return null;
  }
  
  // huibq音源播放（来自洛雪huibq音源 lxmusicapi.onrender.com）
  // 支持 wy(网易云)、kw(酷我)、kg(酷狗)，仅128k
  // tx(QQ) 和 mg(咪咕) 不可用
  // API格式: GET /url/${source}/${songId}/${quality}
  // Header: X-Request-Key: share-v3
  async function playViaHuibq(platform, songId, quality = '128k') {
    if (!songId) return null;
    // tx/mg 已知不可用，跳过
    if (platform === 'tx' || platform === 'mg') return null;
    const apiUrl = `https://lxmusicapi.onrender.com/url/${platform}/${songId}/${quality}`;
    try {
      const resp = await axios.get(apiUrl, {
        headers: {
          'X-Request-Key': 'share-v3',
          'User-Agent': 'lx-music-request/v1.2.0'
        },
        timeout: 10000,
        validateStatus: s => true
      });
      const body = resp.data;
      if (body && body.code === 0 && body.url && body.url.startsWith('http')) {
        // panspace.kuwo.cn 是有效的回退音频（158KB MP3），也接受
        const bitrate = quality === '320k' ? 320 : 128;
        const isHighQuality = body.url.includes('kuwo.cn') && !body.url.includes('panspace');
        return { success: true, url: body.url, quality: isHighQuality ? 'high' : 'standard', bitrate, source: `huibq-${platform}` };
      }
    } catch (e) { console.log(`huibq ${platform} 播放失败:`, e.message); }
    return null;
  }
  
  // QQ音乐搜索+播放（尝试获取播放链接）
  async function searchAndPlayQQ(keyword) {
    try {
      // 搜索QQ音乐
      const searchResp = await axios.get('https://c.y.qq.com/soso/soso-search', {
        params: { p: 1, n: 5, w: keyword, format: 'json' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://y.qq.com' },
        timeout: 8000
      });
      const songs = searchResp?.data?.data?.song?.list || [];
      for (const song of songs) {
        const songmid = song.songmid;
        if (!songmid) continue;
        // 尝试多种播放链接格式
        const urls = [
          `https://dl.stream.qqmusic.qq.com/${songmid}.m4a?fromtag=140`,
          `http://ws.stream.qqmusic.qq.com/${songmid}.m4a?fromtag=140`,
          `https://isure.stream.qqmusic.qq.com/${songmid}.m4a?fromtag=140`,
        ];
        for (const url of urls) {
          try {
            const r = await axios.head(url, {
              headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com' },
              timeout: 5000, maxRedirects: 3
            });
            const ct = r.headers['content-type'] || '';
            if (ct.includes('audio') || ct.includes('octet-stream')) {
              return { success: true, url, quality: 'standard', bitrate: 128, source: 'qq' };
            }
          } catch (e) { /* 继续 */ }
        }
      }
    } catch (e) { console.log('QQ音乐搜索失败:', e.message); }
    return null;
  }
  
  // 酷狗搜索+播放（尝试获取播放链接）
  async function searchAndPlayKugou(keyword) {
    try {
      const searchResp = await axios.get('http://mobilecdn.kugou.com/api/v3/search/song', {
        params: { format: 'json', keyword, package: 0, page: 1, pagesize: 5 },
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10)' },
        timeout: 8000
      });
      const songs = searchResp?.data?.data?.info || [];
      for (const song of songs) {
        const hash = song.hash;
        if (!hash) continue;
        // 尝试多种播放链接
        const urls = [
          `http://trackercdn.kugou.com/i/v2/?hash=${hash}&key=${hash}&appid=1005&pid=2&cmd=25&behavior=play`,
          `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=${hash}&appid=1005`,
          `http://trackercdnbj.kugou.com/i/v2/?hash=${hash}&key=${hash}&appid=1005&pid=2&cmd=25&behavior=play`,
        ];
        for (const url of urls) {
          try {
            const r = await axios.get(url, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              timeout: 5000
            });
            const playUrl = r.data?.url || r.data?.data?.play_url || '';
            if (playUrl && playUrl.startsWith('http')) {
              return { success: true, url: playUrl, quality: 'standard', bitrate: 128, source: 'kugou' };
            }
          } catch (e) { /* 继续 */ }
        }
      }
    } catch (e) { console.log('酷狗搜索失败:', e.message); }
    return null;
  }
  
  // ===== 播放策略 =====
  // 三个可用API：
  // 1. huibq (lxmusicapi.onrender.com) - 支持 wy/kw/kg，仅128k
  // 2. SVIP kw (musicapi.haitangw.net) - 仅酷我，支持320k高音质
  // 3. 酷我antiserver - 通用回退，支持VIP
  
  const searchKeyword = songName || id;
  
  // 网易云音源：搜网易云获取ID → huibq wy → 网易云外链 → 酷我antiserver
  if (platform === 'netease') {
    try {
      const resp = await axios.get('https://music.163.com/api/search/get', {
        params: { s: searchKeyword, type: 1, limit: 5, offset: 0 },
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com' },
        timeout: 8000
      });
      const songs = resp.data.result?.songs || [];
      // 先尝试huibq wy API（支持VIP歌曲）
      for (const song of songs) {
        const result = await playViaHuibq('wy', String(song.id), '128k');
        if (result) { result.source = 'netease'; return res.json(result); }
      }
      // 再尝试网易云直接外链（免费歌曲）
      for (const song of songs) {
        const result = await tryNeteaseUrl(song.id);
        if (result) { result.source = 'netease'; return res.json(result); }
      }
    } catch (e) { console.log('网易云搜索失败:', e.message); }
    // 回退到酷我antiserver（支持VIP）
    const kuwoResult = await searchAndPlayKuwo(searchKeyword);
    if (kuwoResult) { kuwoResult.source = 'netease-fallback'; return res.json(kuwoResult); }
  }
  
  // QQ音源：搜酷我获取ID → SVIP kw(高音质) → huibq kw → 酷我antiserver
  if (platform === 'qq') {
    try {
      const searchResp = await axios.get('http://search.kuwo.cn/r.s', {
        params: { ft: 'music', rn: '5', pn: '0', encoding: 'utf8', all: searchKeyword, vipver: '1', client: 'kt' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000
      });
      const text = typeof searchResp.data === 'string' ? searchResp.data : String(searchResp.data);
      const kuwoSongs = parseKuwoSearch(text);
      // 先尝试SVIP kw高音质
      for (const song of kuwoSongs) {
        const svipResult = await playViaSvip('kw', song.id, 'exhigh');
        if (svipResult) { svipResult.source = 'qq'; return res.json(svipResult); }
      }
      // 再尝试huibq kw
      for (const song of kuwoSongs) {
        const result = await playViaHuibq('kw', song.id, '128k');
        if (result) { result.source = 'qq'; return res.json(result); }
      }
      // 回退酷我antiserver
      for (const song of kuwoSongs) {
        const result = await playViaKuwo(song.id);
        if (result) { result.source = 'qq'; return res.json(result); }
      }
    } catch (e) { console.log('QQ音源搜索失败:', e.message); }
    const kuwoResult = await searchAndPlayKuwo(searchKeyword);
    if (kuwoResult) { kuwoResult.source = 'qq-fallback'; return res.json(kuwoResult); }
  }
  
  // 酷狗音源：搜酷狗获取hash → huibq kg → 搜酷我 → SVIP/huibq/antiserver
  if (platform === 'kugou') {
    try {
      // 先搜酷狗获取hash，用huibq kg播放
      const searchResp = await axios.get('http://mobilecdn.kugou.com/api/v3/search/song', {
        params: { format: 'json', keyword: searchKeyword, package: 0, page: 1, pagesize: 5 },
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10)' },
        timeout: 8000
      });
      const songs = searchResp?.data?.data?.info || [];
      // 尝试huibq kg API
      for (const song of songs) {
        if (!song.hash) continue;
        const result = await playViaHuibq('kg', song.hash, '128k');
        if (result) { result.source = 'kugou'; return res.json(result); }
      }
    } catch (e) { console.log('酷狗搜索失败:', e.message); }
    // 回退到搜酷我 → SVIP kw / huibq kw / antiserver
    try {
      const searchResp = await axios.get('http://search.kuwo.cn/r.s', {
        params: { ft: 'music', rn: '5', pn: '0', encoding: 'utf8', all: searchKeyword, vipver: '1', client: 'kt' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000
      });
      const text = typeof searchResp.data === 'string' ? searchResp.data : String(searchResp.data);
      const kuwoSongs = parseKuwoSearch(text);
      for (const song of kuwoSongs) {
        const svipResult = await playViaSvip('kw', song.id, 'exhigh');
        if (svipResult) { svipResult.source = 'kugou'; return res.json(svipResult); }
      }
      for (const song of kuwoSongs) {
        const result = await playViaKuwo(song.id);
        if (result) { result.source = 'kugou'; return res.json(result); }
      }
    } catch (e) { console.log('酷狗回退酷我搜索失败:', e.message); }
    const kuwoResult = await searchAndPlayKuwo(searchKeyword);
    if (kuwoResult) { kuwoResult.source = 'kugou-fallback'; return res.json(kuwoResult); }
  }
  
  // 酷我音源：搜酷我获取ID → SVIP kw(320kbps高音质) → huibq kw → 酷我antiserver
  if (platform === 'kuwo') {
    try {
      const searchResp = await axios.get('http://search.kuwo.cn/r.s', {
        params: { ft: 'music', rn: '5', pn: '0', encoding: 'utf8', all: searchKeyword, vipver: '1', client: 'kt' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000
      });
      const text = typeof searchResp.data === 'string' ? searchResp.data : String(searchResp.data);
      const kuwoSongs = parseKuwoSearch(text);
      // 先尝试SVIP kw高音质
      for (const song of kuwoSongs) {
        const svipResult = await playViaSvip('kw', song.id, 'exhigh');
        if (svipResult) { svipResult.source = 'kuwo'; return res.json(svipResult); }
      }
      // 再尝试huibq kw
      for (const song of kuwoSongs) {
        const result = await playViaHuibq('kw', song.id, '128k');
        if (result) { result.source = 'kuwo'; return res.json(result); }
      }
      // 回退酷我antiserver直连
      for (const song of kuwoSongs) {
        const result = await playViaKuwo(song.id);
        if (result) { result.source = 'kuwo'; return res.json(result); }
      }
    } catch (e) { console.log('酷我搜索失败:', e.message); }
    const kuwoResult = await searchAndPlayKuwo(searchKeyword);
    if (kuwoResult) { kuwoResult.source = 'kuwo'; return res.json(kuwoResult); }
  }
  
  // 默认：尝试酷我搜索
  const defaultResult = await searchAndPlayKuwo(searchKeyword);
  if (defaultResult) { defaultResult.source = 'kuwo'; return res.json(defaultResult); }
  
  res.json({ success: false, message: '所有音源均无法播放此歌曲，请尝试搜索其他歌曲' });
}

// 音频代理流 - 解决跨域和外链失效问题
app.get('/api/stream', async (req, res) => {
  const { url, referer } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  
  try {
    // 先解析网易云重定向
    let finalUrl = url;
    if (url.includes('music.163.com/song/media')) {
      try {
        const headResp = await axios.head(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          timeout: 8000,
          maxRedirects: 0,
          validateStatus: (s) => s <= 302
        });
        if (headResp.headers.location) {
          finalUrl = headResp.headers.location;
        }
      } catch (e) { /* 使用原始URL */ }
    }
    
    // 根据 URL 域名自动设置 Referer
    let autoReferer = 'https://music.163.com';
    try {
      const urlObj = new URL(finalUrl);
      const host = urlObj.hostname;
      if (host.includes('kuwo.cn')) autoReferer = 'https://www.kuwo.cn';
      else if (host.includes('kugou.com')) autoReferer = 'https://www.kugou.com';
      else if (host.includes('qq.com') || host.includes('y.qq.com')) autoReferer = 'https://y.qq.com';
      else if (host.includes('163.com')) autoReferer = 'https://music.163.com';
    } catch (e) {}
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': referer || autoReferer
    };
    
    // 设置响应头
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    });
    
    const response = await axios.get(finalUrl, {
      headers,
      responseType: 'stream',
      timeout: 30000,
      maxRedirects: 5
    });
    
    // 检查内容类型，如果是 HTML 说明是错误页面
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      return res.status(404).json({ error: '音频不可用', source: 'html_response' });
    }
    
    // 转发内容类型
    const audioType = contentType || 'audio/mpeg';
    res.set('Content-Type', audioType);
    if (response.headers['content-length']) {
      res.set('Content-Length', response.headers['content-length']);
    }
    res.set('Accept-Ranges', 'bytes');
    
    response.data.pipe(res);
    response.data.on('error', () => res.end());
  } catch (error) {
    console.error('音频流代理失败:', error.message);
    res.status(500).json({ error: 'Stream failed' });
  }
});

// 获取歌词 - 支持 query 参数
app.get('/api/lyric', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.json({ success: false, lyric: '' });
  try {
    const response = await axios.get('https://music.163.com/api/song/lyric', {
      params: { id, lv: 1 },
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com' },
      timeout: 8000
    });
    res.json({ success: true, lyric: response.data.lrc?.lyric || '', tlyric: response.data.tlyric?.lyric || '' });
  } catch (error) {
    res.json({ success: false, lyric: '' });
  }
});

app.get('/api/lyric/netease/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get('https://music.163.com/api/song/lyric', {
      params: { id, lv: 1 },
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://music.163.com'
      },
      timeout: 8000
    });
    
    const lrc = response.data.lrc?.lyric || '';
    const tlrc = response.data.tlyric?.lyric || '';
    res.json({ success: true, lyric: lrc, tlyric: tlrc });
  } catch (error) {
    res.json({ success: false, lyric: '', message: '获取歌词失败' });
  }
});

// 获取歌曲详情（音质信息）
app.get('/api/song/detail/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get('https://music.163.com/api/song/detail', {
      params: { ids: `[${id}]` },
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com' },
      timeout: 8000
    });
    
    const song = response.data.songs?.[0];
    if (song) {
      const qualities = [];
      if (song.hMusic) qualities.push({ level: 'super', name: '超品', bitrate: 320 });
      if (song.mMusic) qualities.push({ level: 'high', name: '高品质', bitrate: 192 });
      if (song.lMusic) qualities.push({ level: 'standard', name: '标准', bitrate: 128 });
      
      res.json({ success: true, data: { qualities, name: song.name, artist: song.artists?.map(a => a.name).join('/') } });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    res.json({ success: false });
  }
});

// 查询歌曲可用音质
app.get('/api/song/qualities', async (req, res) => {
  const { platform, id, name = '' } = req.query;
  if (!platform || !id) return res.json({ success: false, qualities: [] });

  const qualities = [];
  const keyword = name || id;

  // 根据平台检测可用音质
  if (platform === 'netease') {
    // 网易云：通过 song/detail API 获取音质信息
    try {
      const resp = await axios.get('https://music.163.com/api/song/detail', {
        params: { ids: `[${id}]` },
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com' },
        timeout: 8000
      });
      const song = resp.data.songs?.[0];
      if (song) {
        if (song.hMusic) qualities.push({ level: 'super', name: '超品 HQ', bitrate: 320, format: 'mp3' });
        if (song.mMusic) qualities.push({ level: 'high', name: '高品质', bitrate: 192, format: 'mp3' });
        if (song.lMusic) qualities.push({ level: 'standard', name: '标准', bitrate: 128, format: 'mp3' });
      }
    } catch (e) { /* 忽略 */ }
    // 始终提供标准音质作为保底
    if (qualities.length === 0) {
      qualities.push({ level: 'standard', name: '标准', bitrate: 128, format: 'mp3' });
    }
  } else if (platform === 'kuwo') {
    // 酷我：通过 antiserver 探测可用音质
    try {
      const searchResp = await axios.get('http://search.kuwo.cn/r.s', {
        params: { ft: 'music', rn: '5', pn: '0', encoding: 'utf8', all: keyword, vipver: '1', client: 'kt' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000
      });
      const text = typeof searchResp.data === 'string' ? searchResp.data : String(searchResp.data);
      const lines = text.split('\n');
      let kuwoId = '';
      for (const line of lines) {
        if (line.startsWith('MUSICRID=')) {
          kuwoId = line.substring(9).trim().replace('MUSIC_', '');
          break;
        }
      }
      if (kuwoId) {
        // 探测320k
        try {
          const hqResp = await axios.get('https://antiserver.kuwo.cn/anti.s', {
            params: { type: 'convert_url3', format: 'mp3', response: 'url', br: '320kmp3', rid: `MUSIC_${kuwoId}` },
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kuwo.cn' },
            timeout: 6000, responseType: 'text'
          });
          let hqUrl = '';
          const hqData = typeof hqResp.data === 'string' ? hqResp.data : String(hqResp.data);
          try { hqUrl = JSON.parse(hqData).url || ''; } catch { hqUrl = hqData.trim(); }
          if (hqUrl && hqUrl.startsWith('http')) {
            qualities.push({ level: 'super', name: '超品 HQ', bitrate: 320, format: 'mp3' });
          }
        } catch (e) { /* 无HQ */ }
        // 探测128k
        try {
          const resp = await axios.get('https://antiserver.kuwo.cn/anti.s', {
            params: { type: 'convert_url', format: 'mp3', response: 'url', rid: `MUSIC_${kuwoId}` },
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kuwo.cn' },
            timeout: 6000, responseType: 'text'
          });
          let url = typeof resp.data === 'string' ? resp.data.trim() : '';
          if (url && url.startsWith('http')) {
            qualities.push({ level: 'standard', name: '标准', bitrate: 128, format: 'mp3' });
          }
        } catch (e) { /* 无标准 */ }
      }
    } catch (e) { /* 忽略 */ }
    if (qualities.length === 0) {
      qualities.push({ level: 'standard', name: '标准', bitrate: 128, format: 'mp3' });
    }
  } else {
    // QQ/酷狗：通用探测，提供标准和高品质
    try {
      // 搜酷我获取ID来探测音质
      const searchResp = await axios.get('http://search.kuwo.cn/r.s', {
        params: { ft: 'music', rn: '3', pn: '0', encoding: 'utf8', all: keyword, vipver: '1', client: 'kt' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000
      });
      const text = typeof searchResp.data === 'string' ? searchResp.data : String(searchResp.data);
      const lines = text.split('\n');
      let kuwoId = '';
      for (const line of lines) {
        if (line.startsWith('MUSICRID=')) {
          kuwoId = line.substring(9).trim().replace('MUSIC_', '');
          break;
        }
      }
      if (kuwoId) {
        // 探测320k
        try {
          const hqResp = await axios.get('https://antiserver.kuwo.cn/anti.s', {
            params: { type: 'convert_url3', format: 'mp3', response: 'url', br: '320kmp3', rid: `MUSIC_${kuwoId}` },
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kuwo.cn' },
            timeout: 6000, responseType: 'text'
          });
          let hqUrl = '';
          const hqData = typeof hqResp.data === 'string' ? hqResp.data : String(hqResp.data);
          try { hqUrl = JSON.parse(hqData).url || ''; } catch { hqUrl = hqData.trim(); }
          if (hqUrl && hqUrl.startsWith('http')) {
            qualities.push({ level: 'super', name: '超品 HQ', bitrate: 320, format: 'mp3' });
          }
        } catch (e) { /* 无HQ */ }
        // 探测128k
        try {
          const resp = await axios.get('https://antiserver.kuwo.cn/anti.s', {
            params: { type: 'convert_url', format: 'mp3', response: 'url', rid: `MUSIC_${kuwoId}` },
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kuwo.cn' },
            timeout: 6000, responseType: 'text'
          });
          let url = typeof resp.data === 'string' ? resp.data.trim() : '';
          if (url && url.startsWith('http')) {
            qualities.push({ level: 'standard', name: '标准', bitrate: 128, format: 'mp3' });
          }
        } catch (e) { /* 无标准 */ }
      }
    } catch (e) { /* 忽略 */ }
    if (qualities.length === 0) {
      qualities.push({ level: 'standard', name: '标准', bitrate: 128, format: 'mp3' });
    }
  }

  res.json({ success: true, qualities });
});

// 推荐歌单/排行榜
app.get('/api/playlist/top', async (req, res) => {
  try {
    const response = await axios.get('https://music.163.com/api/toplist/detail', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com' },
      timeout: 10000
    });
    
    const lists = (response.data.list || []).slice(0, 5).map(item => ({
      id: item.id,
      name: item.name,
      coverImgUrl: item.coverImgUrl,
      updateFrequency: item.updateFrequency
    }));
    
    res.json({ success: true, data: lists });
  } catch (error) {
    res.json({ success: false, data: [] });
  }
});

// 歌单详情 - 支持 query 参数
app.get('/api/playlist', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.json({ success: false, data: [] });
  try {
    const response = await axios.get('https://music.163.com/api/v6/playlist/detail', {
      params: { id },
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com' },
      timeout: 10000
    });
    const tracks = (response.data.playlist?.tracks || []).map(song => ({
      id: song.id, name: song.name,
      artist: song.ar?.map(a => a.name).join(' / ') || '未知',
      album: song.al?.name || '', albumPic: song.al?.picUrl || '',
      duration: song.dt, platform: 'netease',
      platformUrl: `https://music.163.com/#/song?id=${song.id}`
    }));
    res.json({ success: true, data: tracks, name: response.data.playlist?.name || '' });
  } catch (error) {
    res.json({ success: false, data: [] });
  }
});

app.get('/api/playlist/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get('https://music.163.com/api/v6/playlist/detail', {
      params: { id },
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com' },
      timeout: 10000
    });
    
    const tracks = (response.data.playlist?.tracks || []).map(song => ({
      id: song.id,
      name: song.name,
      artist: song.ar?.map(a => a.name).join(' / ') || '未知',
      album: song.al?.name || '',
      albumPic: song.al?.picUrl || '',
      duration: song.dt,
      platform: 'netease',
      platformUrl: `https://music.163.com/#/song?id=${song.id}`
    }));
    
    res.json({ 
      success: true, 
      data: tracks,
      name: response.data.playlist?.name || ''
    });
  } catch (error) {
    res.json({ success: false, data: [] });
  }
});

// 获取局域网IP（优先选择主网络）
function getLanIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // 优先选择 192.168.1.x 主网络，跳过热点虚拟网卡
        if (iface.address.startsWith('192.168.1.')) return iface.address;
        candidates.push(iface.address);
      }
    }
  }
  return candidates[0] || 'localhost';
}

// 启动公网隧道（使用固定子域名，方便APK自动连接）
async function startTunnel(port) {
  try {
    const localtunnel = require('localtunnel');
    console.log('   正在建立公网连接...');
    const tunnel = await localtunnel({ port, subdomain: 'musicbox2024' });
    console.log(`   🌐 公网访问: ${tunnel.url}`);
    console.log(`   📱 APK自动连接地址: ${tunnel.url}`);
    tunnel.on('close', () => {
      console.log('   公网连接已断开');
    });
    return tunnel;
  } catch (e) {
    console.log('   ⚠️ 公网隧道启动失败:', e.message);
    return null;
  }
}

// 启动服务器（支持动态端口，监听所有网络接口）
function startServer(preferredPort, options = {}) {
  const port = preferredPort || PORT;
  const lanIP = getLanIP();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', async () => {
      const actualPort = server.address().port;
      console.log(`🎵 音乐播放器已启动`);
      console.log(`   本机访问: http://localhost:${actualPort}`);
      console.log(`   局域网访问: http://${lanIP}:${actualPort}`);
      
      let tunnel = null;
      if (options.public) {
        tunnel = await startTunnel(actualPort);
      }
      
      resolve({ server, port: actualPort, lanIP, tunnel });
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`端口 ${port} 被占用，尝试随机端口...`);
        const fallback = app.listen(0, '0.0.0.0', async () => {
          const actualPort = fallback.address().port;
          console.log(`🎵 音乐播放器已启动`);
          console.log(`   本机访问: http://localhost:${actualPort}`);
          console.log(`   局域网访问: http://${lanIP}:${actualPort}`);
          
          let tunnel = null;
          if (options.public) {
            tunnel = await startTunnel(actualPort);
          }
          
          resolve({ server: fallback, port: actualPort, lanIP, tunnel });
        });
        fallback.on('error', reject);
      } else {
        reject(err);
      }
    });
  });
}

// 独立运行时直接启动
if (require.main === module) {
  const isPublic = process.argv.includes('--public');
  startServer(null, { public: isPublic });
}

module.exports = { app, startServer };
