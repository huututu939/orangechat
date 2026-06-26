// Supabase 外置记忆库插件
// 功能：消息同步到 Supabase

// ==================== 配置和状态 ====================

const CONFIG = {
  supabaseUrl: '',
  supabaseKey: ''
};

// 当前对话上下文（由 message_sent / message_received 事件自动维护）
// 这样工具调用时无需 AI 模型提供 conversation_id
var CURRENT_CONTEXT = {
  assistant_id: '',
  conversation_id: ''
};

// 初始化配置
function initConfig() {
  CONFIG.supabaseUrl = config.supabase_url || '';
  CONFIG.supabaseKey = config.supabase_key || '';
}

// Supabase REST API 请求
function supabaseRequest(table, method, data, query) {
  var url = CONFIG.supabaseUrl + '/rest/v1/' + table + (query || '');
  var headers = {
    'apikey': CONFIG.supabaseKey,
    'Authorization': 'Bearer ' + CONFIG.supabaseKey,
    'Content-Type': 'application/json'
  };
  // 仅 POST 请求发送 Prefer 头，避免空头导致部分服务器拒绝
  if (method === 'POST') {
    headers['Prefer'] = 'return=representation';
  }

  var response = fetch(url, {
    method: method,
    headers: headers,
    body: data ? JSON.stringify(data) : undefined
  });

  if (!response.ok) {
    // 读取并返回 Supabase 的完整错误信息，便于排查
    var errBody = '';
    try { errBody = response.text(); } catch (e) {}
    throw new Error('Supabase error ' + response.status + ': ' + errBody);
  }

  // 解析响应，对空响应体做容错
  var rawBody = '';
  try { rawBody = response.text(); } catch (e) {}
  if (!rawBody) return [];
  try {
    return JSON.parse(rawBody);
  } catch (e) {
    return rawBody;
  }
}

// ==================== 事件处理 ====================

// 消息发送时
function onMessageSent(event) {
  initConfig();

  // 自动维护当前对话上下文
  if (event.conversation_id) {
    CURRENT_CONTEXT.conversation_id = event.conversation_id;
  }
  if (event.assistant_id) {
    CURRENT_CONTEXT.assistant_id = event.assistant_id;
  }

  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    return;
  }

  var message = {
    assistant_id: event.assistant_id,
    conversation_id: event.conversation_id,
    role: 'user',
    content: event.message,
    created_at: new Date().toISOString()
  };

  try {
    supabaseRequest('chat_messages', 'POST', message);
  } catch (error) {
    console.error('Failed to sync message:', error);
  }
}

// 消息接收时
function onMessageReceived(event) {
  initConfig();

  // 自动维护当前对话上下文
  if (event.conversation_id) {
    CURRENT_CONTEXT.conversation_id = event.conversation_id;
  }
  if (event.assistant_id) {
    CURRENT_CONTEXT.assistant_id = event.assistant_id;
  }

  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    return;
  }

  var message = {
    assistant_id: event.assistant_id,
    conversation_id: event.conversation_id,
    role: 'assistant',
    content: event.message,
    created_at: new Date().toISOString()
  };

  try {
    supabaseRequest('chat_messages', 'POST', message);
  } catch (error) {
    console.error('Failed to sync message:', error);
  }
}

// ==================== 工具函数 ====================

// 获取最近30条聊天记录
function memory_recall_recent(params) {
  initConfig();

  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    return { success: false, error: 'Supabase not configured' };
  }

  // 优先使用 AI 传入的 conversation_id，否则使用自动维护的当前对话上下文
  var conversationId = params.conversation_id || CURRENT_CONTEXT.conversation_id;
  if (!conversationId) {
    return { success: false, error: 'conversation_id is required (no active conversation context available)' };
  }

  try {
    var query = '?conversation_id=eq.' + encodeURIComponent(conversationId) +
                '&order=created_at.desc&limit=30';
    var results = supabaseRequest('chat_messages', 'GET', null, query);

    // 按时间正序排列（最早的在前）
    results.reverse();

    return {
      success: true,
      data: results
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// 关键词搜索聊天记录
function memory_search(params) {
  initConfig();

  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    return { success: false, error: 'Supabase not configured' };
  }

  var query = params.query || '';
  // 优先使用 AI 传入的 conversation_id，否则使用自动维护的当前对话上下文
  var conversationId = params.conversation_id || CURRENT_CONTEXT.conversation_id;
  var limit = params.limit || 20;

  if (!query) {
    return { success: false, error: 'query is required' };
  }

  try {
    // 使用 Supabase ilike 进行全文搜索
    var urlQuery = '?content=ilike.*' + encodeURIComponent(query) + '*&limit=' + limit;
    if (conversationId) {
      urlQuery += '&conversation_id=eq.' + encodeURIComponent(conversationId);
    }
    urlQuery += '&order=created_at.desc';

    var results = supabaseRequest('chat_messages', 'GET', null, urlQuery);

    return {
      success: true,
      data: results
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// 主动写入记忆库
function memory_write(params) {
  initConfig();

  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    return { success: false, error: 'Supabase not configured' };
  }

  var content = params.content;
  // 优先使用 AI 传入的 ID，否则使用自动维护的当前对话上下文
  var assistantId = params.assistant_id || CURRENT_CONTEXT.assistant_id;
  var conversationId = params.conversation_id || CURRENT_CONTEXT.conversation_id;

  if (!content) {
    return { success: false, error: 'content is required' };
  }

  try {
    var message = {
      assistant_id: assistantId || 'manual',
      conversation_id: conversationId || 'manual',
      role: 'system',
      content: content,
      created_at: new Date().toISOString()
    };

    var result = supabaseRequest('chat_messages', 'POST', message);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ==================== 导出 ====================

exports.onMessageSent = onMessageSent;
exports.onMessageReceived = onMessageReceived;
exports.memory_recall_recent = memory_recall_recent;
exports.memory_search = memory_search;
exports.memory_write = memory_write;