// 音乐工作室插件
// 功能：Suno 生成原创歌曲 + Replicate RVC 音色替换 + 音乐库管理

// ==================== 配置 ====================

function getConfig() {
  return {
    sunoApiUrl: (config.suno_api_url || '').replace(/\/$/, ''),
    sunoApiKey: (config.suno_api_key || '').replace(/^Bearer\s+/i, '').trim(),
    replicateApiKey: (config.replicate_api_key || '').trim(),
    voiceModelUrl: (config.voice_model_url || '').trim(),
  };
}

// ==================== HTTP 请求封装 ====================

async function httpPost(url, headers, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('HTTP ' + response.status + ': ' + errorText);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function httpGet(url, headers, timeoutMs) {
  var options = {
    method: 'GET',
    headers: headers || {},
  };
  // 支持可选超时（用于 Replicate 等长查询）
  if (timeoutMs && typeof AbortController !== 'undefined') {
    var controller = new AbortController();
    options.signal = controller.signal;
    setTimeout(function () { controller.abort(); }, timeoutMs);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('HTTP ' + response.status + ': ' + errorText);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// 延时函数（毫秒）
function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// ==================== Suno 歌曲生成 ====================

// 提交生成任务
async function sunoSubmit(cfg, lyrics, style) {
  const headers = {
    'Authorization': 'Bearer ' + cfg.sunoApiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };

  const payload = {
    gpt_description_prompt: 'A song for Xiaoju, style: ' + (style || 'pop'),
    prompt: lyrics.slice(0, 400) + '\n[Outro]\n[End]',
    make_instrumental: false,
    mv: 'chirp-v4',
  };

  const url = cfg.sunoApiUrl + '/suno/submit/music';
  console.log('Suno 提交生成任务:', url);
  const result = await httpPost(url, headers, payload);

  // 兼容多种返回格式提取 task_id
  var taskId = result.data;
  if (typeof taskId !== 'string') {
    if (result.data && typeof result.data === 'object') {
      taskId = result.data.task_id || result.data.id;
    } else {
      taskId = result.task_id;
    }
  }
  if (!taskId) throw new Error('Suno 任务提交失败: ' + JSON.stringify(result));
  return taskId;
}

// 暴力搜索音频 URL（兼容各种返回结构）
function extractAudioUrl(obj) {
  var candidates = [];
  function walk(o) {
    if (typeof o === 'string') {
      var low = o.toLowerCase();
      if (o.indexOf('http') === 0 && ['.mp3', '.wav', 'audio', 'suno', 'cdn', '/stream', 'output'].some(function (k) { return low.indexOf(k) >= 0; })) {
        candidates.push(o);
      }
    } else if (Array.isArray(o)) {
      o.forEach(function (item) { walk(item); });
    } else if (o && typeof o === 'object') {
      var keys = ['audio_url', 'output', 'url', 'audio', 'video_url', 'song', 'download_url', 'file'];
      keys.forEach(function (key) {
        var v = o[key];
        if (typeof v === 'string' && v.indexOf('http') === 0) candidates.push(v);
      });
      Object.keys(o).forEach(function (k) { walk(o[k]); });
    }
  }
  walk(obj);
  return candidates[0] || '';
}

// 轮询任务状态（指数退避，与网关一致）
async function sunoPoll(cfg, taskId) {
  const headers = {
    'Authorization': 'Bearer ' + cfg.sunoApiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };

  const url = cfg.sunoApiUrl + '/suno/fetch/' + taskId;
  // Suno 生成通常需要 1-8 分钟，这里给到约 10 分钟上限
  const maxAttempts = 80;
  var lastResult = null;

  for (let i = 0; i < maxAttempts; i++) {
    // 前 10 次每 3 秒，之后每 8 秒（10*3 + 70*8 ≈ 590 秒 ≈ 10 分钟）
    var interval = i < 10 ? 3000 : 8000;
    await sleep(interval);
    try {
      const result = await httpGet(url, headers);
      lastResult = result;

      // 关键修复：Suno 代理返回嵌套结构，真实任务状态在 result.data 里（对象或数组），
      // 而非最外层 result.status。对齐参考实现 server.py:1771-1773 的解析路径。
      var rootData = result.data;
      var taskInfo;
      if (rootData && typeof rootData === 'object') {
        if (Array.isArray(rootData) && rootData.length > 0) {
          taskInfo = rootData[0];
        } else if (!Array.isArray(rootData)) {
          taskInfo = rootData;
        } else {
          taskInfo = {};
        }
      } else {
        taskInfo = result; // 兜底：某些代理直接把字段放在最外层
      }
      // 状态比较大小写不敏感，兼容不同代理返回
      var status = (taskInfo.status || result.status || '').toString().toUpperCase();

      console.log('Suno 轮询 [' + (i + 1) + '/' + maxAttempts + '] status=' + status);

      if (status === 'SUCCESS') {
        // 音频 URL 提取路径对齐参考实现：优先从 taskInfo 内部找
        var innerData = taskInfo.data;
        var audioUrl = '';
        if (Array.isArray(innerData) && innerData.length > 0) {
          audioUrl = innerData[0].audio_url || '';
        } else if (innerData && typeof innerData === 'object') {
          audioUrl = innerData.audio_url || '';
        } else {
          audioUrl = taskInfo.audio_url || result.audio_url || '';
        }
        // 标准路径没找到，递归暴力搜索
        if (!audioUrl) {
          audioUrl = extractAudioUrl(result);
        }
        if (audioUrl) {
          return { audioUrl: audioUrl };
        }
        throw new Error('Suno 任务成功但未找到音频 URL: ' + JSON.stringify(result));
      }

      if (status === 'FAILURE' || status === 'FAILED' || status === 'ERROR') {
        throw new Error('Suno 生成失败: ' + JSON.stringify(result));
      }
    } catch (e) {
      console.error('Suno 轮询错误:', e.message);
      if (i === maxAttempts - 1) throw e;
    }
  }
  throw new Error('Suno 生成超时（已轮询 ' + maxAttempts + ' 次，最后状态: ' + (lastResult ? lastResult.status : '未知') + '）');
}

// ==================== Replicate RVC 音色替换 ====================

// RVC 模型版本
const RVC_VERSION = '5598e8029cbd7e9268db84ce8c2a334eab6ebccbee67b78cf63c38e964379e15';

async function replicateCover(cfg, songUrl) {
  const headers = {
    'Authorization': 'Bearer ' + cfg.replicateApiKey,
    'Content-Type': 'application/json',
  };

  const payload = {
    version: RVC_VERSION,
    input: {
      song_input: songUrl,
      rvc_model: cfg.voiceModelUrl,
      index_rate: 0.75,
      clean_vocals: true,
      protect_rate: 0.33,
      split_vocals: true,
      autotune_vocals: false,
      f0_method: 'rmvpe',
      pitch_change: -12,
    },
  };

  // 提交预测
  const submitUrl = 'https://api.replicate.com/v1/predictions';
  console.log('Replicate 提交 RVC 任务...');
  const submitResult = await httpPost(submitUrl, headers, payload);

  if (!submitResult || !submitResult.id) {
    throw new Error('Replicate 任务提交失败: ' + JSON.stringify(submitResult));
  }

  const predictionId = submitResult.id;

  // 轮询状态（指数退避，与网关一致）
  const statusUrl = 'https://api.replicate.com/v1/predictions/' + predictionId;
  const maxAttempts = 150;

  for (let i = 0; i < maxAttempts; i++) {
    // 前 20 次每 3 秒，第 21-60 次每 5 秒，第 61 次起每 8 秒
    var interval;
    if (i < 20) {
      interval = 3000;
    } else if (i < 60) {
      interval = 5000;
    } else {
      interval = 8000;
    }
    await sleep(interval);
    try {
      const result = await httpGet(statusUrl, headers, 25000);
      const status = result.status;

      console.log('Replicate 轮询 [' + (i + 1) + '/' + maxAttempts + '] status=' + status);

      if (status === 'succeeded') {
        if (result.output) {
          return typeof result.output === 'string' ? result.output : result.output[0];
        }
        throw new Error('Replicate 成功但未找到输出: ' + JSON.stringify(result));
      }

      if (status === 'failed') {
        throw new Error('Replicate 音色替换失败: ' + JSON.stringify(result.error || result));
      }
    } catch (e) {
      console.error('Replicate 轮询错误:', e.message);
      if (i === maxAttempts - 1) throw e;
    }
  }
  throw new Error('Replicate 音色替换超时');
}

// ==================== 音乐库存储 ====================

function getSongList() {
  try {
    const data = dataStore.get('studio_song_list');
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

function saveSongList(list) {
  dataStore.set('studio_song_list', JSON.stringify(list));
}

function addSong(songData) {
  const list = getSongList();
  list.unshift(songData);
  saveSongList(list);
}

function removeSong(title) {
  const list = getSongList();
  const filtered = list.filter(function (s) { return s.title !== title; });
  saveSongList(filtered);
  return list.length !== filtered.length;
}

function generateId() {
  return 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ==================== 工具：生成歌曲 ====================

async function generate_song(params) {
  const { lyrics, title, style } = params;

  if (!lyrics || !title) {
    return { success: false, error: '缺少必要参数：lyrics 和 title' };
  }

  const cfg = getConfig();
  if (!cfg.sunoApiKey) {
    return { success: false, error: '未配置 Suno API Key，请在插件设置中填写' };
  }

  const wantVoiceReplace = cfg.replicateApiKey && cfg.voiceModelUrl;

  try {
    // === 阶段一：Suno 生成基础歌曲 ===
    console.log('🎸 [阶段一] Suno 生成基础歌曲...');
    const taskId = await sunoSubmit(cfg, lyrics, style);
    const sunoResult = await sunoPoll(cfg, taskId);
    console.log('✅ [阶段一完成] 基础歌曲:', sunoResult.audioUrl);

    let finalUrl = sunoResult.audioUrl;
    let hasVoiceReplacement = false;

    // === 阶段二：（可选）Replicate RVC 音色替换 ===
    if (wantVoiceReplace) {
      console.log('🎙️ [阶段二] Replicate RVC 音色替换...');
      try {
        finalUrl = await replicateCover(cfg, sunoResult.audioUrl);
        hasVoiceReplacement = true;
        console.log('✅ [阶段二完成] 最终歌曲:', finalUrl);
      } catch (e) {
        console.error('⚠️ 音色替换失败，使用原始音频:', e.message);
        // 音色替换失败不阻断，使用原始音频
      }
    }

    // === 存入音乐库 ===
    const songData = {
      id: generateId(),
      title: title,
      style: style || '',
      originalUrl: sunoResult.audioUrl,
      finalUrl: finalUrl,
      hasVoiceReplacement: hasVoiceReplacement,
      createdAt: new Date().toISOString(),
    };
    addSong(songData);

    return {
      success: true,
      data: {
        title: title,
        audioUrl: finalUrl,
        originalUrl: sunoResult.audioUrl,
        hasVoiceReplacement: hasVoiceReplacement,
        message: '歌曲「' + title + '」已生成' + (hasVoiceReplacement ? '（含音色替换）' : '') + '并加入音乐库！',
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== 工具：翻唱歌曲 ====================

async function cover_song(params) {
  const { song_url, title } = params;

  if (!song_url || !title) {
    return { success: false, error: '缺少必要参数：song_url 和 title' };
  }

  const cfg = getConfig();
  if (!cfg.replicateApiKey) {
    return { success: false, error: '未配置 Replicate API Key，无法进行音色替换' };
  }
  if (!cfg.voiceModelUrl) {
    return { success: false, error: '未配置 RVC 音色模型链接' };
  }

  try {
    console.log('🎙️ [翻唱] Replicate RVC 音色替换...');
    const finalUrl = await replicateCover(cfg, song_url);
    console.log('✅ [翻唱完成] 最终歌曲:', finalUrl);

    // 存入音乐库
    const songData = {
      id: generateId(),
      title: title,
      style: '翻唱',
      originalUrl: song_url,
      finalUrl: finalUrl,
      hasVoiceReplacement: true,
      createdAt: new Date().toISOString(),
    };
    addSong(songData);

    return {
      success: true,
      data: {
        title: title,
        audioUrl: finalUrl,
        originalUrl: song_url,
        hasVoiceReplacement: true,
        message: '翻唱歌曲「' + title + '」已生成并加入音乐库！',
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== 工具：列出歌曲 ====================

function list_studio_songs() {
  const list = getSongList();
  return {
    success: true,
    data: {
      count: list.length,
      songs: list,
    },
  };
}

// ==================== 工具：删除歌曲 ====================

function delete_studio_song(params) {
  const { title } = params;
  if (!title) {
    return { success: false, error: '缺少参数：title' };
  }
  const deleted = removeSong(title);
  if (!deleted) {
    return { success: false, error: '未找到歌曲：' + title };
  }
  return {
    success: true,
    data: { message: '歌曲「' + title + '」已删除' },
  };
}

// ==================== 导出 ====================

exports.generate_song = generate_song;
exports.cover_song = cover_song;
exports.list_studio_songs = list_studio_songs;
exports.delete_studio_song = delete_studio_song;