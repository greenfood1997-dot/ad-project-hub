import React, { useState } from "react";
import { LockKeyhole, Mail } from "lucide-react";
import "./login.css";

export default function LoginScreen({ onLogin, sessionKey }) {
  const [email, setEmail] = useState("admin@company.local");
  const [pin, setPin] = useState("123456");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
          <div className="logo-mark">A</div>
          <div>
            <strong>广告项目中台 OA</strong>
            <span>内部项目协作与智能分析</span>
          </div>
        </div>
        <form onSubmit={submit}>
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
        <p className="login-hint">默认管理员：admin@company.local / 123456。上线后请在成员管理里修改 PIN。</p>
      </section>
    </main>
  );
}
