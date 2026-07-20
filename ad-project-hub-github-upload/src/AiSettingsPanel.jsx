import React from "react";

function LogicItem({ title, text }) {
  return <div className="logic-item"><strong>{title}</strong><p>{text}</p></div>;
}

export default function AiSettingsPanel({
  aiSettings,
  setAiSettings,
  aiReady,
  settingsMessage,
  testingAi,
  savingAi,
  onApplyProviderPreset,
  onTestAi,
  onSaveAi
}) {
  return (
    <section className="admin-grid">
      <form className="member-form settings-form" onSubmit={onSaveAi}>
        <div className="section-head">
          <h2>AI 服务配置</h2>
          <span className={`config-state ${aiReady ? "ok" : "warn"}`}>{aiReady ? "已保存 Key" : "未接入"}</span>
        </div>
        <label>
          <span>服务商</span>
          <select value={aiSettings["服务商"] || "DeepSeek"} onChange={(event) => onApplyProviderPreset(event.target.value)}>
            <option value="DeepSeek">DeepSeek</option>
            <option value="Kimi / Moonshot">Kimi / Moonshot</option>
            <option value="GPT / OpenAI">GPT / OpenAI</option>
            <option value="自定义">自定义兼容接口</option>
          </select>
        </label>
        <label><span>API Key</span><input value={aiSettings["API Key"] || ""} type="password" autoComplete="new-password" onChange={(event) => setAiSettings({ ...aiSettings, "API Key": event.target.value })} placeholder={aiReady ? "已安全保存；留空继续使用原 Key" : "粘贴你的 API Key"} /></label>
        <label><span>Base URL</span><input value={aiSettings["Base URL"] || ""} onChange={(event) => setAiSettings({ ...aiSettings, "Base URL": event.target.value })} /></label>
        <label><span>模型名称</span><input value={aiSettings["模型名称"] || ""} onChange={(event) => setAiSettings({ ...aiSettings, "模型名称": event.target.value })} /></label>
        {settingsMessage && <p className="form-message">{settingsMessage}</p>}
        <div className="button-row">
          <button className="ghost" type="button" onClick={onTestAi} disabled={testingAi || savingAi}>{testingAi ? "测试中" : "测试连接"}</button>
          <button type="submit" className="primary" disabled={savingAi || testingAi}>{savingAi ? "保存中" : "保存 AI API"}</button>
        </div>
      </form>
      <div className="member-table settings-help">
        <div className="section-head"><h2>接入说明</h2></div>
        <div className="logic-list">
          <LogicItem title="为什么看起来没了" text="如果覆盖上传时带了空的 data/db.json，线上保存过的 AI API 可能被重置。新版已支持 Render 环境变量兜底。" />
          <LogicItem title="Render 兜底变量" text="可以在 Render 设置 AI_API_KEY、AI_BASE_URL、AI_MODEL，后台配置为空时也能继续解析。" />
          <LogicItem title="DeepSeek" text="适合成本敏感的表格解析和项目问答，默认 Base URL 为 https://api.deepseek.com。" />
          <LogicItem title="Kimi / Moonshot" text="适合长文本合同理解，可填 moonshot-v1-8k 或你购买的其他模型。" />
          <LogicItem title="OpenAI 兼容" text="支持 OpenAI 或其他兼容 Chat Completions 的服务，只要填写 Base URL、API Key 和模型名。" />
        </div>
      </div>
    </section>
  );
}
