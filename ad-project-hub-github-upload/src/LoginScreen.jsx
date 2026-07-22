import React, { useState } from "react";
import { LockKeyhole, Mail, MessageSquare } from "lucide-react";
import "./login.css";

export default function LoginScreen({ onLogin, sessionKey, notice = "" }) {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const encoded = params.get("feishu_session");
    if (encoded) {
      try {
        const data = JSON.parse(decodeURIComponent(escape(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")))));
        localStorage.setItem(sessionKey, JSON.stringify(data));
        window.history.replaceState({}, "", window.location.pathname + window.location.search);
        onLogin(data);
      } catch { setError("飞书登录结果无法读取，请重试"); }
    } else if (params.get("feishu_error")) setError(params.get("feishu_error"));
  }, [onLogin, sessionKey]);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, pin }),
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "登录失败");
      localStorage.setItem(sessionKey, JSON.stringify(payload.data));
      onLogin(payload.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="logo">
          <div className="logo-mark"><img src="/brand/company-logo-square.png" alt="公司 Logo" /></div>
          <div>
            <strong>广告项目中台 OA</strong>
            <span>内部项目协作与智能分析</span>
          </div>
        </div>
        <form onSubmit={submit}>
          {notice && <p className="login-session-notice">{notice}</p>}
          <label>
            <span>邮箱</span>
            <div className="input-row"><Mail size={16} /><input value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          </label>
          <label>
            <span>PIN</span>
            <div className="input-row"><LockKeyhole size={16} /><input value={pin} type="password" onChange={(event) => setPin(event.target.value)} /></div>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="primary" disabled={loading}>{loading ? "登录中" : "进入系统"}</button>
        </form>
        <div className="login-divider"><span>或</span></div>
        <a className="feishu-login-button" href="/api/auth/feishu"><MessageSquare size={17} />使用飞书账号登录</a>
        <p className="login-hint">请使用管理员分配的内部账号登录。</p>
      </section>
    </main>
  );
}
