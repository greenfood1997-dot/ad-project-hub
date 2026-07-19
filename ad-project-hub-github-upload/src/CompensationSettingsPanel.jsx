import React, { useEffect, useMemo, useState } from "react";
import { money } from "./utils/format.js";

export default function CompensationSettingsPanel({ api, session }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState({ members: [], projects: [], compensationMembers: [], allocations: [], dividends: [], shareholderTotals: [] });
  const [message, setMessage] = useState("");
  const [dividendProjectId, setDividendProjectId] = useState("");
  const [distributionRate, setDistributionRate] = useState("60");
  const shareholders = useMemo(() => data.members.filter((item) => item.role === "shareholder"), [data.members]);

  async function load() {
    setData(await api(`/api/compensation?year=${year}`));
  }
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [year]);

  async function saveMember(member, field, value) {
    const current = data.compensationMembers.find((item) => item.userId === member.id) || {};
    await api("/api/compensation/member", { method: "POST", body: JSON.stringify({ userId: member.id, monthlyCost: field === "monthlyCost" ? value : current.monthlyCost || 0, projectRate: field === "projectRate" ? value : current.projectRate ?? 100, includesSocialSecurity: true }) });
    setMessage(`已保存 ${member.name} 的月度综合成本。`);
    await load();
  }

  async function allocate() {
    await api("/api/compensation/allocate", { method: "POST", body: JSON.stringify({ month }) });
    setMessage(`${month} 人力成本分摊预览已生成。`);
    await load();
  }

  async function saveDividend() {
    if (!dividendProjectId) return setMessage("请先选择项目");
    const weight = shareholders.length ? 100 / shareholders.length : 0;
    await api("/api/compensation/dividend", { method: "POST", body: JSON.stringify({ projectId: dividendProjectId, year, distributionRate, status: "draft", shareholders: shareholders.map((item) => ({ userId: item.id, name: item.name, weight })) }) });
    setMessage("项目分红方案已保存为预计分红。");
    await load();
  }

  return <div className="compensation-settings">
    <div className="settings-block">
      <div className="section-head"><div><h3>成员月度综合成本</h3><span>工资、公司承担社保等；PM 和员工看不到个人金额</span></div></div>
      <div className="compensation-table">
        {data.members.map((member) => {
          const row = data.compensationMembers.find((item) => item.userId === member.id) || {};
          return <div className="compensation-row" key={member.id}>
            <strong>{member.name}<small>{member.role === "shareholder" ? "股东" : member.role}</small></strong>
            <label>月综合成本<input type="number" min="0" step="0.01" defaultValue={row.monthlyCost || 0} onBlur={(event) => saveMember(member, "monthlyCost", event.target.value)} /></label>
            <label>进入项目比例<input type="number" min="0" max="100" step="1" defaultValue={row.projectRate ?? 100} onBlur={(event) => saveMember(member, "projectRate", event.target.value)} /></label>
          </div>;
        })}
      </div>
      <div className="button-row"><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><button type="button" className="primary" onClick={allocate}>生成人力分摊预览</button></div>
      <div className="compact-list">{data.allocations.filter((item) => item.month === month).map((item, index) => <div key={`${item.userId}-${item.projectId}-${index}`}><strong>{item.memberName} → {item.projectName}</strong><span>{money(item.amount)}</span></div>)}</div>
    </div>
    <div className="settings-block">
      <div className="section-head"><div><h3>项目分红与全年汇总</h3><span>分红在项目净利润形成后分配，不作为项目成本重复扣除</span></div><input type="number" value={year} onChange={(event) => setYear(event.target.value)} /></div>
      {session.role === "shareholder" && <div className="dividend-form"><select value={dividendProjectId} onChange={(event) => setDividendProjectId(event.target.value)}><option value="">选择项目</option>{data.projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><label>项目利润分红比例<input type="number" min="0" max="100" value={distributionRate} onChange={(event) => setDistributionRate(event.target.value)} /></label><button type="button" className="primary" onClick={saveDividend}>保存项目分红</button></div>}
      <div className="compensation-summary">{data.shareholderTotals.map((item) => <div key={item.userId}><strong>{item.name}</strong><span>全年预计 {money(item.expected)}</span><span>已确认 {money(item.confirmed)}</span><span>已发放 {money(item.paid)}</span></div>)}</div>
      <div className="compact-list">{data.dividends.map((item) => <div key={`${item.projectId}-${item.year}`}><strong>{item.projectName}</strong><span>净利润 {money(item.profit)} · 可分红 {money(item.distributable)} · 公司留存 {money(item.retained)}</span></div>)}</div>
    </div>
    {message && <p className="settings-message">{message}</p>}
  </div>;
}
