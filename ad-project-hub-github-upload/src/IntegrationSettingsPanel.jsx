import React, { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

function SettingsSection({ id, title, description, openSection, setOpenSection, children }) {
  const open = openSection === id;
  return (
    <section className={`settings-accordion ${open ? "open" : ""}`}>
      <button type="button" className="settings-accordion-trigger" aria-expanded={open} onClick={() => setOpenSection(open ? "" : id)}>
        <span><strong>{title}</strong><em>{description}</em></span>
        <ChevronDown size={18} />
      </button>
      {open && <div className="settings-accordion-body">{children}</div>}
    </section>
  );
}

export default function IntegrationSettingsPanel({
  feishuSettings,
  setFeishuSettings,
  wechatSettings,
  setWechatSettings,
  storageSettings,
  setStorageSettings,
  approvalSettings,
  setApprovalSettings,
  alertSettings,
  setAlertSettings,
  savingSettingType,
  syncingFeishuContacts,
  feishuSyncResult,
  testingStorage,
  storageTestResult,
  settingNextStep,
  automaticNotificationStatus,
  onSaveTypedSetting,
  onSyncFeishuContacts,
  onTestStorageUpload,
  focusFeishuField
}) {
  const [openSection, setOpenSection] = useState("feishu");
  useEffect(() => {
    if (!focusFeishuField?.field) return;
    setOpenSection("feishu");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const input = document.querySelector(`[data-feishu-field="${focusFeishuField.field}"]`);
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      input?.focus({ preventScroll: true });
    }));
  }, [focusFeishuField]);
  return (
    <div className="integration-settings-accordion">
      <SettingsSection id="feishu" title="飞书机器人" description="通讯录、事件订阅、文件接收与消息发送" openSection={openSection} setOpenSection={setOpenSection}>
        <p className="settings-next-step">{settingNextStep("feishu")}</p>
        <p className="settings-next-step">自动开户需要飞书通讯录成员与部门只读权限；飞书登录需要“获取用户身份”权限，并在飞书安全设置中登记 OA 回调地址。敏感 OA 角色仍只能由管理员手工授予。</p>
        {[
          ["appId", "App ID"],
          ["appSecret", "App Secret"],
          ["eventUrl", "事件订阅 URL"],
          ["verificationToken", "Verification Token"],
          ["tenantAccessToken", "Tenant Access Token（可选）"],
          ["oauthRedirectUrl", "飞书登录回调地址（可选）"],
          ["mockSend", "模拟发送通知（true/false）"],
          ["mockContactsJson", "测试通讯录 JSON（可选）"],
          ["mockFileBase64", "测试文件 Base64（可选）"],
          ["mockFileName", "测试文件名（可选）"],
          ["mockFileType", "测试文件类型（可选）"]
        ].map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            {key === "mockContactsJson"
              ? <textarea rows={4} value={feishuSettings[key]} onChange={(event) => setFeishuSettings({ ...feishuSettings, [key]: event.target.value })} placeholder='[{"name":"张三","email":"zhangsan@company.com","open_id":"ou_xxx","department":"项目部"}]' />
              : <input data-feishu-field={key} type={key === "appSecret" || key === "verificationToken" ? "password" : "text"} value={feishuSettings[key]} onChange={(event) => setFeishuSettings({ ...feishuSettings, [key]: event.target.value })} />}
          </label>
        ))}
        <label className="setting-check"><input type="checkbox" checked={feishuSettings.hrAuthoritative === true || feishuSettings.hrAuthoritative === "true"} onChange={(event) => setFeishuSettings({ ...feishuSettings, hrAuthoritative: event.target.checked })} /><span>将飞书人事作为 OA 人员权威源（入职开户、离职停用）</span></label>
        <label>
          <span>OA 事件地址</span>
          <input value="/api/integrations/feishu/events" readOnly />
        </label>
        <button type="button" className="ghost" disabled={savingSettingType === "feishu" || syncingFeishuContacts} onClick={() => onSaveTypedSetting("feishu", feishuSettings, "飞书配置")}>{savingSettingType === "feishu" ? "保存中" : "保存飞书配置"}</button>
        <button type="button" className="ghost" disabled={syncingFeishuContacts || savingSettingType === "feishu"} onClick={onSyncFeishuContacts}>{syncingFeishuContacts ? "同步中" : "同步飞书通讯录"}</button>
        {feishuSyncResult && <p className="form-message">最近同步：新增 {feishuSyncResult.created} 人，更新 {feishuSyncResult.updated} 人，跳过 {feishuSyncResult.skipped} 人。</p>}
      </SettingsSection>

      <SettingsSection id="wechat" title="企业微信" description="群机器人和企业应用消息配置" openSection={openSection} setOpenSection={setOpenSection}>
        <p className="settings-next-step">{settingNextStep("wechat")}</p>
        {[
          ["webhookUrl", "群机器人 Webhook"],
          ["corpId", "Corp ID"],
          ["agentId", "Agent ID"],
          ["secret", "应用 Secret"]
        ].map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input value={wechatSettings[key]} onChange={(event) => setWechatSettings({ ...wechatSettings, [key]: event.target.value })} />
          </label>
        ))}
        <button type="button" className="ghost" disabled={savingSettingType === "wechat"} onClick={() => onSaveTypedSetting("wechat", wechatSettings, "企业微信配置")}>{savingSettingType === "wechat" ? "保存中" : "保存企业微信配置"}</button>
      </SettingsSection>

      <SettingsSection id="storage" title="对象存储" description="合同、发票和票据的长期文件保存" openSection={openSection} setOpenSection={setOpenSection}>
        <p className="settings-next-step">{settingNextStep("storage")}</p>
        {[
          ["provider", "服务商"],
          ["bucket", "Bucket"],
          ["publicBaseUrl", "访问域名"],
          ["endpoint", "S3 Endpoint"],
          ["region", "Region"],
          ["pathPrefix", "路径前缀"],
          ["accessKeyId", "Access Key ID"],
          ["secretAccessKey", "Secret Access Key"],
          ["pathStyle", "Path Style（true/false）"],
          ["mockUpload", "模拟上传（true/false）"]
        ].map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input type={key === "secretAccessKey" ? "password" : "text"} value={storageSettings[key]} onChange={(event) => setStorageSettings({ ...storageSettings, [key]: event.target.value })} />
          </label>
        ))}
        <div className="button-row compact">
          <button type="button" className="ghost" disabled={savingSettingType === "storage" || testingStorage} onClick={() => onSaveTypedSetting("storage", storageSettings, "对象存储配置")}>{savingSettingType === "storage" ? "保存中" : "保存存储配置"}</button>
          <button type="button" className="ghost" disabled={testingStorage || savingSettingType === "storage"} onClick={onTestStorageUpload}>{testingStorage ? "测试中" : "测试存储上传"}</button>
        </div>
        {storageTestResult && (
          <div className={`storage-test-result ${storageTestResult.ok ? "ok" : "warn"}`}>
            <strong>{storageTestResult.ok ? "测试上传成功" : "测试上传未通过"}</strong>
            <span>{storageTestResult.storageStatus || "未返回存储状态"} · {storageTestResult.provider || storageSettings.provider || "local"}</span>
            {storageTestResult.storageUrl && <a href={storageTestResult.storageUrl} target="_blank" rel="noreferrer">打开存储地址</a>}
            {storageTestResult.localStorageUrl && <a href={storageTestResult.localStorageUrl} target="_blank" rel="noreferrer">打开本地备份</a>}
            {storageTestResult.storageRemoteError && <em>{storageTestResult.storageRemoteError}</em>}
            {storageTestResult.warning && <em>{storageTestResult.warning}</em>}
          </div>
        )}
      </SettingsSection>

      <SettingsSection id="approval" title="审批阈值" description="备用金、财务和老板审批金额线" openSection={openSection} setOpenSection={setOpenSection}>
        <p className="settings-next-step">{settingNextStep("approvalRules")}</p>
        {[
          ["pettyCashDirectorLimit", "备用金总监审批线"],
          ["financeRequiredAmount", "财务介入金额"],
          ["ownerRequiredAmount", "老板审批金额"]
        ].map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input value={approvalSettings[key]} onChange={(event) => setApprovalSettings({ ...approvalSettings, [key]: event.target.value })} />
          </label>
        ))}
        <button type="button" className="ghost" disabled={savingSettingType === "approvalRules"} onClick={() => onSaveTypedSetting("approvalRules", approvalSettings, "审批规则")}>{savingSettingType === "approvalRules" ? "保存中" : "保存审批规则"}</button>
      </SettingsSection>

      <SettingsSection id="notifications" title="自动外部提醒" description="高风险待办的飞书与企业微信推送" openSection={openSection} setOpenSection={setOpenSection}>
        <p className="settings-next-step">默认关闭。开启后，后台巡检只会把本次新出现的高风险待办推送到所选渠道；中风险和既有待办仍留在 OA，避免重复打扰同事。</p>
        <label className="setting-check"><input type="checkbox" checked={alertSettings.autoNotifyEnabled === true || alertSettings.autoNotifyEnabled === "true"} onChange={(event) => setAlertSettings({ ...alertSettings, autoNotifyEnabled: event.target.checked })} /><span>开启高风险自动提醒</span></label>
        <label className="setting-check"><input type="checkbox" checked={(alertSettings.autoNotifyChannels || []).includes("feishu")} onChange={(event) => {
          const channels = new Set(alertSettings.autoNotifyChannels || []);
          event.target.checked ? channels.add("feishu") : channels.delete("feishu");
          setAlertSettings({ ...alertSettings, autoNotifyChannels: [...channels] });
        }} /><span>飞书私聊</span></label>
        <label className="setting-check"><input type="checkbox" checked={(alertSettings.autoNotifyChannels || []).includes("wechat")} onChange={(event) => {
          const channels = new Set(alertSettings.autoNotifyChannels || []);
          event.target.checked ? channels.add("wechat") : channels.delete("wechat");
          setAlertSettings({ ...alertSettings, autoNotifyChannels: [...channels] });
        }} /><span>企业微信机器人</span></label>
        <p className={`form-message auto-notification-status ${automaticNotificationStatus.ready ? "ok" : "warn"}`}>{automaticNotificationStatus.text}</p>
        <button type="button" className="ghost" disabled={savingSettingType === "alertSettings"} onClick={() => onSaveTypedSetting("alertSettings", alertSettings, "自动提醒规则")}>{savingSettingType === "alertSettings" ? "保存中" : "保存自动提醒规则"}</button>
      </SettingsSection>
    </div>
  );
}
