/**
 * The configuration page served by `@deepseek-ai/dsh-ragflow/config`: one
 * self-contained HTML document, no build step and no network origin but the
 * host itself.
 *
 * Two rules the markup follows. Every control is hand-written rather than
 * generated from the schema, because a form a person reads is a product
 * decision (which fields matter, what an empty one inherits) that a schema
 * renderer cannot make. And every field is "leave empty to inherit": the box
 * carries only the user's own override, while the placeholder names the value
 * that is in effect without one — so what is on screen is exactly what gets
 * stored, and clearing a box is how a field goes back to inheriting.
 *
 * The inline script deliberately avoids template literals: this whole document
 * lives inside one, and nesting them would turn every interpolation into an
 * escaping puzzle.
 *
 * @module @deepseek-ai/dsh-ragflow/config-page
 */

/** The complete configuration page, served verbatim at the plugin's route. */
export const CONFIG_PAGE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>RAGFlow</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9;
    --panel: #ffffff;
    --border: #e3e5e9;
    --text: #1b1d21;
    --muted: #6b7280;
    --accent: #3b5bdb;
    --accent-text: #ffffff;
    --danger: #b42318;
    --ok: #12805c;
    --chip: #eef1f6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17181c;
      --panel: #1f2126;
      --border: #303338;
      --text: #e8eaed;
      --muted: #9aa1ab;
      --accent: #6b8afd;
      --accent-text: #101215;
      --danger: #f2807a;
      --ok: #52c1a0;
      --chip: #2a2d33;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 20px 64px;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Roboto, sans-serif;
  }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .lede { color: var(--muted); margin: 0 0 24px; }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .card > h2 { font-size: 15px; margin: 0 0 2px; }
  .card > .sub { color: var(--muted); margin: 0 0 18px; font-size: 13px; }
  .field { margin-bottom: 18px; }
  .field:last-child { margin-bottom: 0; }
  .field-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  label { font-weight: 600; font-size: 13px; }
  .chip {
    font-size: 11px;
    color: var(--muted);
    background: var(--chip);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .chip.on { color: var(--ok); }
  input, select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  input:disabled, select:disabled { opacity: .6; }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .hint { color: var(--muted); font-size: 12px; margin-top: 6px; }
  .actions { display: flex; align-items: center; gap: 10px; margin-top: 24px; flex-wrap: wrap; }
  button {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  button:disabled { opacity: .5; cursor: default; }
  .status { flex: 1; min-width: 200px; font-size: 13px; color: var(--muted); }
  .status.err { color: var(--danger); }
  .status.ok { color: var(--ok); }
  .banner {
    border: 1px solid var(--border);
    border-left: 3px solid var(--danger);
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 16px;
    font-size: 13px;
    display: none;
  }
  footer { color: var(--muted); font-size: 12px; margin-top: 20px; word-break: break-all; }
</style>
</head>
<body>
<main>
  <h1 id="t-title">RAGFlow</h1>
  <p class="lede" id="t-lede"></p>

  <div class="banner" id="banner"></div>

  <section class="card">
    <h2 id="t-conn"></h2>
    <p class="sub" id="t-conn-sub"></p>

    <div class="field">
      <div class="field-head"><label for="apiKey" id="l-apiKey"></label><span class="chip" id="c-apiKey"></span></div>
      <input id="apiKey" type="password" autocomplete="off" spellcheck="false">
      <div class="hint" id="h-apiKey"></div>
    </div>

    <div class="field">
      <div class="field-head"><label for="apiKeyEnv" id="l-apiKeyEnv"></label><span class="chip" id="c-apiKeyEnv"></span></div>
      <input id="apiKeyEnv" type="text" autocomplete="off" spellcheck="false">
      <div class="hint" id="h-apiKeyEnv"></div>
    </div>

    <div class="field">
      <div class="field-head"><label for="baseURL" id="l-baseURL"></label><span class="chip" id="c-baseURL"></span></div>
      <input id="baseURL" type="text" autocomplete="off" spellcheck="false">
      <div class="hint" id="h-baseURL"></div>
    </div>

    <div class="field">
      <div class="field-head"><label for="datasetIds" id="l-datasetIds"></label><span class="chip" id="c-datasetIds"></span></div>
      <input id="datasetIds" type="text" autocomplete="off" spellcheck="false">
      <div class="hint" id="h-datasetIds"></div>
    </div>

    <div class="field">
      <div class="field-head"><label for="documentIds" id="l-documentIds"></label><span class="chip" id="c-documentIds"></span></div>
      <input id="documentIds" type="text" autocomplete="off" spellcheck="false">
      <div class="hint" id="h-documentIds"></div>
    </div>
  </section>

  <section class="card">
    <h2 id="t-retrieval"></h2>
    <p class="sub" id="t-retrieval-sub"></p>

    <div class="field">
      <div class="field-head"><label for="similarityThreshold" id="l-similarityThreshold"></label><span class="chip" id="c-similarityThreshold"></span></div>
      <input id="similarityThreshold" type="number" step="0.05" min="0" max="1">
      <div class="hint" id="h-similarityThreshold"></div>
    </div>

    <div class="field">
      <div class="field-head"><label for="vectorTopK" id="l-vectorTopK"></label><span class="chip" id="c-vectorTopK"></span></div>
      <input id="vectorTopK" type="number" step="1" min="1">
      <div class="hint" id="h-vectorTopK"></div>
    </div>

    <div class="field">
      <div class="field-head"><label for="vectorSimilarityWeight" id="l-vectorSimilarityWeight"></label><span class="chip" id="c-vectorSimilarityWeight"></span></div>
      <input id="vectorSimilarityWeight" type="number" step="0.05" min="0" max="1">
      <div class="hint" id="h-vectorSimilarityWeight"></div>
    </div>

    <div class="field">
      <div class="field-head"><label for="keyword" id="l-keyword"></label><span class="chip" id="c-keyword"></span></div>
      <select id="keyword">
        <option value="" id="o-keyword-inherit"></option>
        <option value="true" id="o-keyword-on"></option>
        <option value="false" id="o-keyword-off"></option>
      </select>
      <div class="hint" id="h-keyword"></div>
    </div>

    <div class="field">
      <div class="field-head"><label for="rerankId" id="l-rerankId"></label><span class="chip" id="c-rerankId"></span></div>
      <input id="rerankId" type="text" autocomplete="off" spellcheck="false">
      <div class="hint" id="h-rerankId"></div>
    </div>
  </section>

  <section class="card">
    <h2 id="t-tool"></h2>
    <p class="sub" id="t-tool-sub"></p>

    <div class="field">
      <div class="field-head"><label for="maxChunks" id="l-maxChunks"></label><span class="chip" id="c-maxChunks"></span></div>
      <input id="maxChunks" type="number" step="1" min="1">
      <div class="hint" id="h-maxChunks"></div>
    </div>

    <div class="field">
      <div class="field-head"><label for="timeoutMs" id="l-timeoutMs"></label><span class="chip" id="c-timeoutMs"></span></div>
      <input id="timeoutMs" type="number" step="1000" min="1">
      <div class="hint" id="h-timeoutMs"></div>
    </div>
  </section>

  <div class="actions">
    <button class="primary" id="save"></button>
    <button id="revert"></button>
    <button id="probe"></button>
    <span class="status" id="status"></span>
  </div>

  <footer id="footer"></footer>
</main>

<script>
(function () {
  var ZH = String(navigator.language || 'en').toLowerCase().indexOf('zh') === 0;
  var T = ZH ? {
    lede: '这些参数保存在 DSH 的用户设置与凭据存储中，保存后对下一次检索立即生效。',
    conn: 'RAGFlow 连接',
    connSub: '知识库实例的地址与访问凭据。',
    retrieval: '检索参数',
    retrievalSub: '每次检索下发给 RAGFlow 的打分与召回选项。',
    tool: 'ragflow_retrieve 工具',
    toolSub: '模型单次调用能拿到多少内容、等多久。',
    apiKey: 'API Key',
    apiKeyHint: '不写入设置文件，保存到凭据存储。留空表示保持当前密钥。',
    apiKeyConfigured: '已配置密钥。',
    apiKeyMissing: '尚未配置密钥。',
    apiKeyShadowed: '当前密钥来自启动环境（只读），此处无法改写；请修改环境变量后重启 dsh。',
    apiKeyNoService: '本部署未挂载凭据服务，无法在此保存密钥。',
    apiKeyEnv: '凭据引用名',
    apiKeyEnvHint: '密钥在凭据存储中的键名，也是回落到环境变量时读取的变量名。',
    baseURL: '接口地址',
    baseURLHint: '端点基址，其后自动追加 /api/v1/retrieval。留空则依次使用 $RAGFLOW_BASE_URL 与默认地址。',
    datasetIds: '数据集 ID',
    datasetIdsHint: '逗号分隔。RAGFlow 拒绝既无数据集也无文档的检索，因此这一项必须有值（或由 $RAGFLOW_DATASET_IDS 提供）。',
    documentIds: '文档 ID',
    documentIdsHint: '逗号分隔。在数据集之下进一步收窄检索范围，留空表示不限定。',
    similarityThreshold: '相似度阈值',
    similarityThresholdHint: '综合相似度低于此值的 chunk 被丢弃。',
    vectorTopK: '向量候选池大小',
    vectorTopKHint: 'RAGFlow 的 top_k：参与打分的候选数量，不是返回条数。留空则用 RAGFlow 自己的默认值。',
    vectorSimilarityWeight: '向量权重',
    vectorSimilarityWeightHint: '混合打分中向量部分的权重，取值 0–1。留空则用 RAGFlow 自己的默认值。',
    keyword: '关键词匹配',
    keywordHint: '在向量检索之外同时启用 RAGFlow 的关键词匹配。',
    keywordInherit: '继承（未设置）',
    keywordOn: '启用',
    keywordOff: '关闭',
    rerankId: '重排模型',
    rerankIdHint: '作用于候选池的 rerank 模型 id，留空表示不重排。',
    maxChunks: '返回 chunk 上限',
    maxChunksHint: '单次调用最多返回多少个 chunk。',
    timeoutMs: '超时（毫秒）',
    timeoutMsHint: '单次调用的超时预算。该值在工具注册时读取，改动需重启 dsh 后生效。',
    save: '保存',
    revert: '放弃修改',
    probe: '测试检索',
    saving: '正在保存…',
    saved: '已保存。',
    probing: '正在向 RAGFlow 发起一次检索…',
    inherited: '继承',
    overridden: '已覆盖',
    empty: '留空表示继承',
    loadFailed: '读取当前配置失败：',
    saveFailed: '保存失败：',
    probeOk: '连接正常，返回 %d 个 chunk。',
    probeEmpty: '连接正常，但这次检索没有命中任何 chunk（数据集为空或问题不相关）。',
    probeFailed: '检索失败：',
    noSettings: '本部署未挂载设置服务，页面只读；请改用 cordis.patch.yml 或环境变量。',
    noSection: '对应的插件行未装载，这一节暂不可编辑。',
    effective: '当前生效：',
    fromEnv: '来自环境变量 ',
    docPath: '设置文件：',
    badNumber: '请填写合法数字：'
  } : {
    lede: 'These values live in DSH user settings and the credential store; a save applies to the next retrieval.',
    conn: 'RAGFlow connection',
    connSub: 'Where the knowledge-base instance is, and how to authenticate.',
    retrieval: 'Retrieval options',
    retrievalSub: 'Scoring and recall options sent to RAGFlow on every retrieval.',
    tool: 'ragflow_retrieve tool',
    toolSub: 'How much one model call gets back, and how long it may take.',
    apiKey: 'API key',
    apiKeyHint: 'Never written to a settings file; stored in the credential store. Leave empty to keep the current key.',
    apiKeyConfigured: 'A key is configured.',
    apiKeyMissing: 'No key configured yet.',
    apiKeyShadowed: 'The current key comes from the launch environment (read-only). Change the variable and restart dsh.',
    apiKeyNoService: 'This deployment mounts no credential provider, so no key can be saved here.',
    apiKeyEnv: 'Credential reference',
    apiKeyEnvHint: 'Key name in the credential store, and the environment variable read when falling back to it.',
    baseURL: 'Endpoint',
    baseURLHint: 'Base URL; /api/v1/retrieval is appended. Empty falls back to $RAGFLOW_BASE_URL, then the default.',
    datasetIds: 'Dataset ids',
    datasetIdsHint: 'Comma-separated. RAGFlow refuses a retrieval naming no dataset and no document, so this must resolve to something (here or via $RAGFLOW_DATASET_IDS).',
    documentIds: 'Document ids',
    documentIdsHint: 'Comma-separated. Narrows the search below the datasets; empty means no document filter.',
    similarityThreshold: 'Similarity threshold',
    similarityThresholdHint: 'Chunks below this combined similarity are dropped.',
    vectorTopK: 'Vector candidate pool',
    vectorTopKHint: "RAGFlow's top_k: how many candidates are scored, NOT how many are returned. Empty uses RAGFlow's own default.",
    vectorSimilarityWeight: 'Vector weight',
    vectorSimilarityWeightHint: "Weight of the vector half of the hybrid score, 0–1. Empty uses RAGFlow's own default.",
    keyword: 'Keyword matching',
    keywordHint: "Run RAGFlow's keyword pass alongside vector search.",
    keywordInherit: 'Inherit (unset)',
    keywordOn: 'On',
    keywordOff: 'Off',
    rerankId: 'Rerank model',
    rerankIdHint: 'Rerank model id applied to the candidate pool; empty means no rerank.',
    maxChunks: 'Max chunks',
    maxChunksHint: 'Upper bound on chunks returned by one call.',
    timeoutMs: 'Timeout (ms)',
    timeoutMsHint: 'Budget for one call. Read when the tool registers, so a change applies after restarting dsh.',
    save: 'Save',
    revert: 'Discard changes',
    probe: 'Test retrieval',
    saving: 'Saving…',
    saved: 'Saved.',
    probing: 'Running one retrieval against RAGFlow…',
    inherited: 'inherited',
    overridden: 'overridden',
    empty: 'empty = inherit',
    loadFailed: 'Could not read the current configuration: ',
    saveFailed: 'Save failed: ',
    probeOk: 'Connection works; %d chunk(s) returned.',
    probeEmpty: 'Connection works, but this retrieval matched nothing (empty dataset or unrelated question).',
    probeFailed: 'Retrieval failed: ',
    noSettings: 'This deployment mounts no settings provider; the page is read-only. Use cordis.patch.yml or environment variables.',
    noSection: 'The owning plugin row is not loaded, so this section cannot be edited.',
    effective: 'in effect: ',
    fromEnv: 'from environment variable ',
    docPath: 'Settings file: ',
    badNumber: 'Not a valid number: '
  };

  var PROVIDER_TEXT = ['apiKeyEnv', 'baseURL', 'rerankId'];
  var PROVIDER_IDS = ['datasetIds', 'documentIds'];
  var PROVIDER_NUM = ['similarityThreshold', 'vectorTopK', 'vectorSimilarityWeight'];
  var TOOL_NUM = ['maxChunks', 'timeoutMs'];
  var ALL = PROVIDER_TEXT.concat(PROVIDER_IDS, PROVIDER_NUM, ['keyword'], TOOL_NUM);

  var base = location.pathname.replace(/\\/+$/, '');
  var state = null;
  var el = function (id) { return document.getElementById(id); };

  function setStatus(message, kind) {
    var node = el('status');
    node.textContent = message || '';
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  function labels() {
    el('t-lede').textContent = T.lede;
    el('t-conn').textContent = T.conn;
    el('t-conn-sub').textContent = T.connSub;
    el('t-retrieval').textContent = T.retrieval;
    el('t-retrieval-sub').textContent = T.retrievalSub;
    el('t-tool').textContent = T.tool;
    el('t-tool-sub').textContent = T.toolSub;
    el('save').textContent = T.save;
    el('revert').textContent = T.revert;
    el('probe').textContent = T.probe;
    el('o-keyword-inherit').textContent = T.keywordInherit;
    el('o-keyword-on').textContent = T.keywordOn;
    el('o-keyword-off').textContent = T.keywordOff;
    el('l-apiKey').textContent = T.apiKey;
    for (var i = 0; i < ALL.length; i++) {
      var key = ALL[i];
      el('l-' + key).textContent = T[key];
      el('h-' + key).textContent = T[key + 'Hint'];
    }
  }

  function joinIds(value) { return Array.isArray(value) ? value.join(', ') : ''; }

  function splitIds(text) {
    return text.split(',').map(function (part) { return part.trim(); }).filter(function (part) { return part.length > 0; });
  }

  function chip(key, section) {
    var node = el('c-' + key);
    if (!section.available) { node.textContent = ''; return; }
    var owned = section.overridden.indexOf(key) >= 0;
    node.textContent = owned ? T.overridden : T.inherited;
    node.className = 'chip';
  }

  function inheritedText(section, key) {
    var value = section.value[key];
    if (value === undefined || value === null || value === '') return T.empty;
    if (Array.isArray(value)) return value.length > 0 ? joinIds(value) : T.empty;
    return String(value);
  }

  function fill(key, section, display) {
    var input = el(key);
    var owned = section.available && section.overridden.indexOf(key) >= 0;
    input.value = owned ? display(section.value[key]) : '';
    input.placeholder = owned ? '' : inheritedText(section, key);
    input.disabled = !section.available || !state.settingsAvailable;
    chip(key, section);
  }

  function render() {
    var provider = state.provider;
    var tool = state.tool;
    var identity = function (value) { return value === undefined || value === null ? '' : String(value); };

    for (var i = 0; i < PROVIDER_TEXT.length; i++) fill(PROVIDER_TEXT[i], provider, identity);
    for (var j = 0; j < PROVIDER_IDS.length; j++) fill(PROVIDER_IDS[j], provider, joinIds);
    for (var k = 0; k < PROVIDER_NUM.length; k++) fill(PROVIDER_NUM[k], provider, identity);
    for (var m = 0; m < TOOL_NUM.length; m++) fill(TOOL_NUM[m], tool, identity);

    var keyword = el('keyword');
    var keywordOwned = provider.available && provider.overridden.indexOf('keyword') >= 0;
    keyword.value = keywordOwned ? String(provider.value.keyword === true) : '';
    keyword.disabled = !provider.available || !state.settingsAvailable;
    chip('keyword', provider);

    var apiKey = el('apiKey');
    apiKey.value = '';
    apiKey.disabled = !state.credentialsAvailable || !state.credential.writable;
    var keyChip = el('c-apiKey');
    keyChip.textContent = state.credential.configured ? T.apiKeyConfigured : T.apiKeyMissing;
    keyChip.className = 'chip' + (state.credential.configured ? ' on' : '');
    var keyHint = T.apiKeyHint;
    if (!state.credentialsAvailable) keyHint = T.apiKeyNoService;
    else if (!state.credential.writable) keyHint = T.apiKeyShadowed;
    el('h-apiKey').textContent = keyHint + ' (' + state.credential.ref + ')';

    var baseHint = T.baseURLHint + ' ' + T.effective + state.effective.baseURL;
    if (state.env.baseURL) baseHint += ' · ' + T.fromEnv + 'RAGFLOW_BASE_URL';
    el('h-baseURL').textContent = baseHint;

    var datasetHint = T.datasetIdsHint;
    if (state.effective.datasetIds.length > 0) {
      datasetHint += ' ' + T.effective + state.effective.datasetIds.join(', ');
      if (state.env.datasetIds && provider.value.datasetIds && provider.value.datasetIds.length === 0) {
        datasetHint += ' · ' + T.fromEnv + 'RAGFLOW_DATASET_IDS';
      }
    }
    el('h-datasetIds').textContent = datasetHint;

    var banner = el('banner');
    var warning = '';
    if (!state.settingsAvailable) warning = T.noSettings;
    else if (!provider.available || !tool.available) warning = T.noSection;
    banner.textContent = warning;
    banner.style.display = warning ? 'block' : 'none';

    el('save').disabled = !state.settingsAvailable && !state.credentialsAvailable;
    el('footer').textContent = state.documentPath ? T.docPath + state.documentPath : '';
  }

  function numberOf(key) {
    var raw = el(key).value.trim();
    if (raw === '') return null;
    var value = Number(raw);
    if (!isFinite(value)) throw new Error(T.badNumber + T[key]);
    return value;
  }

  function textOf(key) {
    var raw = el(key).value.trim();
    return raw === '' ? null : raw;
  }

  function idsOf(key) {
    var list = splitIds(el(key).value);
    return list.length === 0 ? null : list;
  }

  function collect() {
    var body = {};
    if (state.provider.available && state.settingsAvailable) {
      var fields = {};
      for (var i = 0; i < PROVIDER_TEXT.length; i++) fields[PROVIDER_TEXT[i]] = textOf(PROVIDER_TEXT[i]);
      for (var j = 0; j < PROVIDER_IDS.length; j++) fields[PROVIDER_IDS[j]] = idsOf(PROVIDER_IDS[j]);
      for (var k = 0; k < PROVIDER_NUM.length; k++) fields[PROVIDER_NUM[k]] = numberOf(PROVIDER_NUM[k]);
      var keyword = el('keyword').value;
      fields.keyword = keyword === '' ? null : keyword === 'true';
      body.provider = { revision: state.provider.revision, fields: fields };
    }
    if (state.tool.available && state.settingsAvailable) {
      var toolFields = {};
      for (var m = 0; m < TOOL_NUM.length; m++) toolFields[TOOL_NUM[m]] = numberOf(TOOL_NUM[m]);
      body.tool = { revision: state.tool.revision, fields: toolFields };
    }
    var apiKey = el('apiKey').value.trim();
    if (apiKey !== '') body.apiKey = apiKey;
    return body;
  }

  function post(path, body) {
    return fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status));
        return data;
      });
    });
  }

  function load() {
    return fetch(base + '/state', { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (data) {
      state = data;
      render();
    });
  }

  el('save').addEventListener('click', function () {
    var body;
    try {
      body = collect();
    } catch (error) {
      setStatus(error.message, 'err');
      return;
    }
    setStatus(T.saving);
    el('save').disabled = true;
    post('/save', body).then(function (data) {
      state = data.state;
      render();
      setStatus(T.saved, 'ok');
    }).catch(function (error) {
      setStatus(T.saveFailed + error.message, 'err');
    }).then(function () {
      el('save').disabled = false;
    });
  });

  el('revert').addEventListener('click', function () {
    setStatus('');
    render();
  });

  el('probe').addEventListener('click', function () {
    setStatus(T.probing);
    el('probe').disabled = true;
    post('/probe', { question: 'ping' }).then(function (data) {
      if (data.chunks > 0) setStatus(T.probeOk.replace('%d', String(data.chunks)), 'ok');
      else setStatus(T.probeEmpty, 'ok');
    }).catch(function (error) {
      setStatus(T.probeFailed + error.message, 'err');
    }).then(function () {
      el('probe').disabled = false;
    });
  });

  labels();
  load().catch(function (error) {
    setStatus(T.loadFailed + error.message, 'err');
  });
})();
</script>
</body>
</html>
`
