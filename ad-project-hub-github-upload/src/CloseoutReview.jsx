import React, { useEffect, useState } from "react";
import { BarChart3, Bot, FileSpreadsheet, ShieldAlert } from "lucide-react";
import { apiRequest } from "./utils/api.js";
import { downloadCsv, money } from "./utils/format.js";
import { closeoutReviewRows } from "./utils/ledgerRows.js";
import { normalizeCostRow } from "./utils/projectMetrics.js";
import "./closeout.css";

function PanelTitle({ icon: Icon, title }) {
  return <h2>{Icon && <Icon size={18} />}{title}</h2>;
}

function Mini({ label, value }) {
  return <div className="mini"><span>{label}</span><strong>{value}</strong></div>;
}

function LogicItem({ title, text }) {
  return <div className="logic-item"><strong>{title}</strong><p>{text}</p></div>;
}

export default function CloseoutReview({ project, isManagement, session, subView, onNotice, onOpenProjectSection, onOpenSupplier, onOpenCollection, onSetSubView, onUpload, onDone }) {
  const [copyingReview, setCopyingReview] = useState(false);
  const [exportingCloseout, setExportingCloseout] = useState(false);
  const [savingCloseout, setSavingCloseout] = useState(false);
  const [savingLearning, setSavingLearning] = useState("");
  const [closeoutNote, setCloseoutNote] = useState(project.closeoutNote || project.extractedFields?.closeoutNote || "");
  useEffect(() => {
    setCloseoutNote(project.closeoutNote || project.extractedFields?.closeoutNote || "");
  }, [project.id, project.closeoutNote, project.extractedFields?.closeoutNote]);
  const costRows = (project.costs || [])
    .map(normalizeCostRow)
    .filter((row) => Number(row.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value));
  const topCost = costRows[0] || { name: "待归集成本", value: project.costUsed };
  const totalCost = costRows.reduce((sum, row) => sum + Number(row.value || 0), 0) || Number(project.costUsed || 0);
  const topCostShare = totalCost ? Math.round((Number(topCost.value || 0) / totalCost) * 100) : 0;
  const costContractRate = project.contract ? Math.round((Number(project.costUsed || 0) / Number(project.contract || 1)) * 100) : 0;
  const suggestedReserve = Math.round(Number(topCost.value || 0) * 1.15);
  const costWarning = costContractRate >= 80
    ? "成本已接近合同金额，下一次同类项目报价要提高安全线或减少非必要支出。"
    : topCostShare >= 45
      ? "单项支出占比偏高，建议复盘供应商报价和是否存在临时追加。"
      : "成本结构相对分散，建议保留当前供应商和预算拆分方法。";
  const showRanking = subView === "支出排行";
  const hasReceivable = Number(project.receivable || 0) > 0;
  const canInspectSupplier = costRows.some((row) => row.name && !/待归集|暂无/.test(row.name));
  const closeoutDone = /已完成|结案|已结案/.test(String(project.status || "")) || Boolean(project.closedAt || project.extractedFields?.closedAt);
  function openCostFiles() {
    onOpenProjectSection?.("files", "已打开项目文件与 AI 解析区，可以补上传成本表、报价表或核销表。");
  }
  function uploadCloseoutMaterial(type = "cost-sheet") {
    onUpload?.(type, project);
    onNotice?.(`已为「${project.name}」打开${type === "verification-sheet" ? "核销表" : "成本表"}上传，AI 会先预览识别，确认后才写入项目。`);
  }
  function openPaymentReview() {
    onOpenProjectSection?.("payments", hasReceivable ? "已打开回款记录区，可以生成催收话术或记录回款。" : "已打开回款记录区，可以检查是否还有未登记流水。");
  }
  function openRanking() {
    onSetSubView?.("支出排行");
    onNotice?.("已切到支出排行，先看最大支出和预算预留建议。");
  }
  function openSupplierReview() {
    if (!canInspectSupplier) {
      onNotice?.("当前还没有明确供应商/成本明细，建议先补上传成本表。");
      return;
    }
    onOpenSupplier?.({ supplier: topCost.name });
  }
  async function copyCloseoutSummary() {
    const ranking = costRows.length
      ? costRows.slice(0, 5).map((row, index) => `${index + 1}. ${row.name}：${money(row.value)}，占总成本 ${totalCost ? Math.round((Number(row.value || 0) / totalCost) * 100) : 0}%`)
      : ["暂无成本明细，建议先上传成本表或等待报销/供应商付款归集。"];
    const lines = [
      `项目结案成本复盘：${project.name}`,
      `客户：${project.client || project.brand || "未填写"}`,
      `合同金额：${money(project.contract)}`,
      `总成本：${money(project.costUsed)}`,
      isManagement ? `项目利润：${money(project.contract - project.costUsed)}，毛利率：${project.margin}%` : "利润信息：普通成员不可见",
      `最大支出：${topCost.name} ${money(topCost.value)}，占总成本 ${topCostShare}%`,
      `成本占合同：${project.contract ? `${costContractRate}%` : "待确认合同"}`,
      `回款状态：${project.receivable > 0 ? `待回款 ${money(project.receivable)}` : "已无待回款"}`,
      `AI 优化建议：${costWarning} 下次同类项目建议为「${topCost.name}」至少预留 ${money(suggestedReserve)}。`,
      "支出排行：",
      ...ranking
    ];
    setCopyingReview(true);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      onNotice?.("结案复盘纪要已复制，可以发给 PM、财务或管理层讨论。");
    } catch (error) {
      onNotice?.(error.message || "复制失败，请稍后再试。");
    } finally {
      setCopyingReview(false);
    }
  }
  async function exportCloseoutReview() {
    setExportingCloseout(true);
    try {
      downloadCsv(`${project.name || "项目"}-结案成本复盘.csv`, closeoutReviewRows({
        project,
        costRows,
        topCost,
        totalCost,
        topCostShare,
        costContractRate,
        suggestedReserve,
        costWarning,
        closeoutNote,
        isManagement
      }));
      onNotice?.(`结案成本复盘 CSV 已导出：${project.name}。`);
    } finally {
      setExportingCloseout(false);
    }
  }
  async function saveCloseoutToClientMemory() {
    const client = project.client || project.brand || "";
    if (!client) {
      onNotice?.("当前项目还没有客户名称，先在项目详情补客户/品牌后再沉淀客户经验。");
      return;
    }
    setSavingLearning("client");
    try {
      const pitfallLines = [
        costContractRate >= 80 ? `成本占合同 ${costContractRate}%，下次报价需提前提高安全线。` : "",
        topCostShare >= 45 ? `最大支出「${topCost.name}」占总成本 ${topCostShare}%，下次需提前锁价或比价。` : "",
        hasReceivable ? `结案后仍有待回款 ${money(project.receivable)}，下次合同需明确回款节点。` : ""
      ].filter(Boolean);
      await apiRequest("/api/clients/profile", session, {
        method: "POST",
        body: JSON.stringify({
          append: true,
          client,
          pitfalls: pitfallLines.join("\n"),
          handoffNote: closeoutNote || `结案复盘：最大支出「${topCost.name}」${money(topCost.value)}，下次同类项目建议预留 ${money(suggestedReserve)}。`
        })
      });
      await onDone?.();
      onNotice?.(`已沉淀到客户档案：${client}，新 PM 交接时会看到这次结案经验。`);
    } catch (error) {
      onNotice?.(error.message);
    } finally {
      setSavingLearning("");
    }
  }
  async function saveCloseoutToSupplierMemory() {
    if (!canInspectSupplier) {
      onNotice?.("当前还没有明确供应商/成本明细，建议先补上传成本表。");
      return;
    }
    setSavingLearning("supplier");
    try {
      await apiRequest("/api/suppliers/rate", session, {
        method: "POST",
        body: JSON.stringify({
          supplier: topCost.name,
          project: project.name,
          score: topCostShare >= 45 || costContractRate >= 80 ? 3 : 5,
          market: "结案成本复盘",
          comment: closeoutNote || `结案复盘：${topCost.name} 支出 ${money(topCost.value)}，占总成本 ${topCostShare}%，下次建议预留 ${money(suggestedReserve)}。`
        })
      });
      await onDone?.();
      onNotice?.(`已沉淀到供应商库：${topCost.name}，推荐星级和评分记录已刷新。`);
    } catch (error) {
      onNotice?.(error.message);
    } finally {
      setSavingLearning("");
    }
  }
  async function markProjectClosed() {
    setSavingCloseout(true);
    try {
      const closedAt = project.closedAt || project.extractedFields?.closedAt || new Date().toISOString();
      await apiRequest("/api/projects/update", session, {
        method: "POST",
        body: JSON.stringify({
          id: project.id,
          values: {
            "项目名称": project.name,
            "客户 / 品牌": project.client || project.brand || "",
            "负责人": project.owner || "",
            "PM": project.pm || project.owner || "",
            "销售": project.sales || "",
            "项目状态": "已完成",
            "合同金额": project.contract,
            "已回款": project.paid,
            "下一节点": hasReceivable ? "结案待回款跟进" : "已结案归档",
            "回款节点": project.paymentDue || "",
            "结案时间": closedAt,
            "结案复盘备注": closeoutNote || `最大支出：${topCost.name} ${money(topCost.value)}，建议下次预留 ${money(suggestedReserve)}。`
          }
        })
      });
      await onDone?.();
      onNotice?.(hasReceivable
        ? `项目已标记结案，仍有待回款 ${money(project.receivable)}，建议继续用催收助手跟进。`
        : "项目已标记结案并归档，成本复盘备注已写入项目审计。");
    } catch (error) {
      onNotice?.(error.message);
    } finally {
      setSavingCloseout(false);
    }
  }
  return (
    <section className="feature-grid">
      {!showRanking && <>
        <div className="feature-panel wide-feature">
          <div className="section-head closeout-head">
            <PanelTitle icon={FileSpreadsheet} title="项目结案成本复盘" />
            <div className="closeout-actions">
              <button type="button" className="ghost" onClick={openRanking}>看支出排行</button>
              <button type="button" className="ghost" onClick={copyCloseoutSummary} disabled={copyingReview}>{copyingReview ? "复制中" : "复制复盘纪要"}</button>
              <button type="button" className="ghost" onClick={exportCloseoutReview} disabled={exportingCloseout}><FileSpreadsheet size={14} />{exportingCloseout ? "导出中" : "导出复盘"}</button>
            </div>
          </div>
          <div className="review-summary">
            <Mini label="合同金额" value={money(project.contract)} />
            <Mini label="总成本" value={money(project.costUsed)} />
            <Mini label={isManagement ? "项目利润" : "结案状态"} value={isManagement ? money(project.contract - project.costUsed) : "待复盘"} />
            <Mini label={isManagement ? "毛利率" : "资料完整度"} value={isManagement ? `${project.margin}%` : `${Math.min(100, project.progress + 12)}%`} />
            <Mini label="项目状态" value={closeoutDone ? "已结案" : project.status || "待结案"} />
            <Mini label="结案时间" value={project.closedAt || project.extractedFields?.closedAt ? new Date(project.closedAt || project.extractedFields?.closedAt).toLocaleDateString("zh-CN") : "待确认"} />
          </div>
          <div className="idea-card">
            <strong>AI 优化建议</strong>
            <p>当前最大支出为「{topCost.name}」{money(topCost.value)}，占总成本 {topCostShare}%。{costWarning} 建议下次同类项目至少为该项预留 {money(suggestedReserve)}。</p>
            <div className="button-row compact closeout-next-actions">
              <button type="button" className="ghost tiny" onClick={openCostFiles}>补成本/核销资料</button>
              <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("cost-sheet")}>上传成本表</button>
              <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("verification-sheet")}>上传核销表</button>
              <button type="button" className="ghost tiny" onClick={openSupplierReview}>查看最大支出来源</button>
              <button type="button" className="ghost tiny" onClick={openPaymentReview}>{hasReceivable ? "跟进待回款" : "检查回款记录"}</button>
            </div>
          </div>
          <div className="closeout-complete-box">
            <label>
              <span>结案复盘备注</span>
              <textarea value={closeoutNote} onChange={(event) => setCloseoutNote(event.target.value)} placeholder="例如：最大支出来自达人拍摄，下次同类项目需提前锁价；尾款已催收，待客户确认核销。" />
            </label>
            <button type="button" className={closeoutDone ? "ghost" : "primary"} onClick={markProjectClosed} disabled={savingCloseout}>
              {savingCloseout ? "归档中" : closeoutDone ? "更新结案备注" : "确认项目结案"}
            </button>
            <div className="button-row compact closeout-memory-actions">
              <button type="button" className="ghost tiny" onClick={saveCloseoutToClientMemory} disabled={savingLearning === "client"}>
                {savingLearning === "client" ? "沉淀中" : "沉淀到客户档案"}
              </button>
              <button type="button" className="ghost tiny" onClick={saveCloseoutToSupplierMemory} disabled={savingLearning === "supplier"}>
                {savingLearning === "supplier" ? "沉淀中" : "沉淀到供应商库"}
              </button>
            </div>
            <span>{closeoutDone ? "项目已进入已完成状态，可继续补充复盘备注。" : "确认后会把项目状态改为已完成，并写入结案时间和审计记录。"}</span>
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={ShieldAlert} title="复盘风险" />
          <div className="compact-list">
            <div><strong>最大支出</strong><span>{topCost.name} · {money(topCost.value)}</span></div>
            <div><strong>最大支出占比</strong><span>{topCostShare}%</span></div>
            <div><strong>成本占合同</strong><span>{project.contract ? `${costContractRate}%` : "待确认合同"}</span></div>
            <div><strong>回款状态</strong><span>{project.receivable > 0 ? `待回款 ${money(project.receivable)}` : "已无待回款"}</span></div>
            <div><strong>下次预算建议</strong><span>{topCost.name} 预留 {money(suggestedReserve)}</span></div>
          </div>
          <div className="button-row compact closeout-next-actions">
            <button type="button" className="primary tiny" onClick={openRanking}>展开支出排行</button>
            <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("cost-sheet")}>上传成本表</button>
            <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("verification-sheet")}>上传核销表</button>
          </div>
        </div>
      </>}
      {showRanking && <>
        <div className="feature-panel wide-feature">
          <PanelTitle icon={BarChart3} title="支出排行" />
          <div className="compact-list">
            {costRows.length ? costRows.slice(0, 8).map(({ name, value }) => (
              <div key={name}>
                <strong>{name}</strong>
                <span>{money(value)} · 占总成本 {totalCost ? Math.round((Number(value || 0) / totalCost) * 100) : 0}%</span>
              </div>
            )) : <div className="empty-state action-empty closeout-cost-empty">
              <strong>暂无成本明细</strong>
              <span>上传成本表、核销表，或让报销/供应商付款审批通过后，支出排行会自动刷新。</span>
              <div className="button-row compact closeout-next-actions">
                <button type="button" className="primary tiny" onClick={() => uploadCloseoutMaterial("cost-sheet")}>上传成本表</button>
                <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("verification-sheet")}>上传核销表</button>
                <button type="button" className="ghost tiny" onClick={openCostFiles}>打开文件区</button>
                <button type="button" className="ghost tiny" onClick={copyCloseoutSummary} disabled={copyingReview}>{copyingReview ? "复制中" : "复制复盘草稿"}</button>
              </div>
            </div>}
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={Bot} title="支出优化建议" />
          <div className="logic-list">
            <LogicItem title="优先复盘" text={`先看最大支出「${topCost.name}」，确认是否有临时追加、供应商报价偏高或审批滞后。`} />
            <LogicItem title="下次控制" text="把高占比支出前置到立项预算里，并设置超过预算阈值时必须重新审批。" />
            <LogicItem title="预算预留" text={`下次同类项目建议为「${topCost.name}」至少预留 ${money(suggestedReserve)}，并在报价阶段写入执行预算。`} />
          </div>
          <div className="button-row compact closeout-next-actions">
            <button type="button" className="ghost tiny" onClick={openSupplierReview}>查看最大支出来源</button>
            <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("cost-sheet")}>上传成本表</button>
            <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("verification-sheet")}>上传核销表</button>
            {hasReceivable && <button type="button" className="primary tiny" onClick={onOpenCollection}>生成催收建议</button>}
          </div>
        </div>
      </>}
    </section>
  );
}
