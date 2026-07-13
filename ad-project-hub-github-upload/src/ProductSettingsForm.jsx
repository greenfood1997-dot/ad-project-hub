import React from "react";

export default function ProductSettingsForm({
  productSettings,
  setProductSettings,
  settingsMessage,
  savingProductSettings,
  onSaveProductSettings
}) {
  return (
    <form className="member-form settings-form" onSubmit={onSaveProductSettings}>
      <div className="section-head"><h2>基础参数</h2></div>
      {Object.keys(productSettings).map((key) => (
        <label key={key}>
          <span>{key}</span>
          <input value={productSettings[key]} onChange={(event) => setProductSettings({ ...productSettings, [key]: event.target.value })} />
        </label>
      ))}
      {settingsMessage && <p className="form-message">{settingsMessage}</p>}
      <button type="submit" className="primary" disabled={savingProductSettings}>{savingProductSettings ? "保存中" : "保存产品设置"}</button>
    </form>
  );
}
