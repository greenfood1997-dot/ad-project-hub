import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Minimize2, UploadCloud } from "lucide-react";
import { apiRequest, fileToPayload, uploadedFileKey } from "./utils/api.js";
import { fileSize, money } from "./utils/format.js";
import { canCreateProjectRole } from "./utils/permissions.js";
import { explainUploadError } from "./utils/uploadErrors.js";
import "./upload.css";

export default function UploadDialog({ session, projects, selected, initialType = "create-project", initialFiles = [], minimized = false, onMinimize, onExpand, onClose, onDone }) {
  const canCreateProject = canCreateProjectRole(session);
  const safeInitialType = initialType === "create-project" && !canCreateProject
    ? (projects.length ? "cost-sheet" : "create-project")
    : initialType;
  const [type, setType] = useState(safeInitialType);
  const [projectId, setProjectId] = useState(selected?.id || projects[0]?.id || "");
  const [values, setValues] = useState({
    "项目名称": "",
    "客户 / 品牌": "",
    "负责人": session.name,
    "合同金额": "",
    "执行预算占比": "60%",
  });
  const [files, setFiles] = useState(() => initialFiles);
  const [message, setMessage] = useState("");
  const [uploadError, setUploadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const bodyRef = useRef(null);
  const previewRef = useRef(null);
  const [progress, setProgress] = useState(() => initialFiles.length
    ? { step: "ready", percent: 12, text: `已选择 ${initialFiles.length} 个文件，下一步点击 AI 预览识别` }
    : { step: "idle", percent: 0, text: "等待选择文件" });
  const targetProject = projects.find((project) => project.id === projectId) || selected || projects[0];
  const needsProject = type !== "create-project";
  const hasProjects = projects.length > 0;
  const typeLabels = {
    "create-project": "新项目：合同 / 报价表",
    "cost-sheet": "已有项目：成本 / 报销表",
    "quote-sheet": "已有项目：合同报价表",
    "verification-sheet": "已有项目：月度核销表"
  };
  const canUseCreateProject = canCreateProject;
  const typeOptions = [
    canUseCreateProject ? ["create-project", typeLabels["create-project"]] : null,
    hasProjects ? ["cost-sheet", typeLabels["cost-sheet"]] : null,
    hasProjects ? ["quote-sheet", typeLabels["quote-sheet"]] : null,
    hasProjects ? ["verification-sheet", typeLabels["verification-sheet"]] : null,
  ].filter(Boolean);

  useEffect(() => {
    if (type === "create-project" && !canUseCreateProject && hasProjects) {
      setType("cost-sheet");
      setMessage("当前账号不能创建新项目，已切换为上传成本 / 报销表到已有项目。");
      setUploadError(null);
      setPreview(null);
      setConfirmed(false);
    }
  }, [type, canUseCreateProject, hasProjects]);

  useEffect(() => {
    if (!preview || loading) return;
    window.requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [preview, loading]);

  function showPreview() {
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function appendPickedFiles(picked = []) {
    setMessage("");
    setUploadError(null);
    const payloads = await Promise.all(picked.map(fileToPayload));
    const oversized = picked.find((file) => file.size > 40 * 1024 * 1024 && /pdf/i.test(file.type || file.name));
    setFiles((current) => {
      const merged = [...current];
      const keys = new Set(current.map(uploadedFileKey));
      payloads.forEach((file) => {
        const key = uploadedFileKey(file);
        if (!keys.has(key)) {
          merged.push(file);
          keys.add(key);
        }
      });
      setProgress({ step: "ready", percent: 12, text: `已选择 ${merged.length} 个文件，下一步点击 AI 预览识别` });
      return merged;
    });
    if (oversized) setMessage("已选择超过 40MB 的 PDF，完整 OCR 可能需要几分钟，请不要重复提交。");
    setPreview(null);
    setConfirmed(false);
  }

  async function pickFiles(event) {
    const picked = Array.from(event.target.files || []);
    await appendPickedFiles(picked);
    event.target.value = "";
  }

  async function dropFiles(event) {
    event.preventDefault();
    const picked = Array.from(event.dataTransfer?.files || []);
    if (!picked.length) return;
    await appendPickedFiles(picked);
  }

  function removeFile(fileKey) {
    setFiles((current) => {
      const next = current.filter((file) => uploadedFileKey(file) !== fileKey);
      setProgress(next.length
        ? { step: "ready", percent: 12, text: `已选择 ${next.length} 个文件，等待重新预览` }
        : { step: "idle", percent: 0, text: "等待选择文件" });
      return next;
    });
    setPreview(null);
    setConfirmed(false);
    setMessage("");
    setUploadError(null);
  }

  function uploadBody() {
    return type === "create-project"
      ? { type, values, files }
      : { type, id: targetProject.id, files };
  }

  async function requestPreview() {
    if (type === "create-project" && !canUseCreateProject) {
      setMessage("当前账号不能创建新项目，请让销售、PM 或管理层上传合同创建项目。");
      setUploadError(null);
      return;
    }
    if (needsProject && !targetProject?.id) {
      setMessage("请先创建项目，再上传成本 / 报销表、报价表或核销表。");
      setUploadError(null);
      return;
    }
    if (type === "create-project" && !files.length && !values["项目名称"]?.trim()) {
      setMessage("请先选择合同/报价表，或至少填写项目名称，避免创建空项目。");
      setUploadError(null);
      return;
    }
    setLoading(true);
    setProgress({ step: "preview", percent: 34, text: "正在上传文件并解析基础信息" });
    setMessage("AI 正在预览识别结果，预览阶段不会写入项目。");
    setUploadError(null);
    try {
      window.setTimeout(() => {
        setProgress((current) => current.step === "preview" ? { step: "preview", percent: 62, text: "正在 OCR / 表格识别，请耐心等待" } : current);
      }, 900);
      const data = await apiRequest("/api/projects/upload-preview", session, {
        method: "POST",
        body: JSON.stringify(uploadBody()),
      });
      setPreview(data);
      setConfirmed(false);
      setProgress({ step: "review", percent: data.canConfirm ? 82 : 70, text: data.canConfirm ? "识别完成，等待你确认入库" : "识别完成，但需要先处理提示" });
      setMessage(data.canConfirm ? "请检查识别结果，确认无误后再入库。" : "识别结果需要处理后才能入库。");
    } catch (error) {
      setProgress({ step: "error", percent: 100, text: "识别失败，请查看提示后重试" });
      setMessage("");
      setUploadError(explainUploadError(error));
    } finally {
      setLoading(false);
    }
  }

  async function confirmUpload() {
    if (type === "create-project" && !canUseCreateProject) {
      setMessage("当前账号不能创建新项目，请让销售、PM 或管理层上传合同创建项目。");
      setUploadError(null);
      return;
    }
    if (needsProject && !targetProject?.id) {
      setMessage("请先创建项目，再上传项目资料。");
      setUploadError(null);
      return;
    }
    if (type === "create-project" && !files.length && !values["项目名称"]?.trim()) {
      setMessage("请先选择合同/报价表，或至少填写项目名称，避免创建空项目。");
      setUploadError(null);
      return;
    }
    setLoading(true);
    setProgress({ step: "confirm", percent: 88, text: "正在写入项目数据并刷新大盘" });
    setMessage("正在确认入库，请稍候...");
    setUploadError(null);
    try {
      if (type === "create-project") {
        await apiRequest("/api/projects", session, {
          method: "POST",
          body: JSON.stringify({ values, files }),
        });
      }
      if (type === "cost-sheet") {
        await apiRequest("/api/projects/cost-sheet", session, {
          method: "POST",
          body: JSON.stringify({ id: targetProject.id, files }),
        });
      }
      if (type === "quote-sheet") {
        await apiRequest("/api/projects/quote-sheet", session, {
          method: "POST",
          body: JSON.stringify({ id: targetProject.id, files }),
        });
      }
      if (type === "verification-sheet") {
        await apiRequest("/api/projects/verification-sheet", session, {
          method: "POST",
          body: JSON.stringify({ id: targetProject.id, files }),
        });
      }
      setMessage("上传成功，项目数据已刷新。");
      setConfirmed(true);
      setProgress({ step: "done", percent: 100, text: "已完成入库，项目数据已刷新" });
      await onDone();
      setTimeout(onClose, 700);
    } catch (error) {
      setProgress({ step: "error", percent: 100, text: "入库失败，请查看提示后重试" });
      setMessage("");
      setUploadError(explainUploadError(error));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!files.length && type !== "create-project") {
      setMessage("请先选择要上传的文件");
      setUploadError(null);
      return;
    }
    if (!preview) {
      await requestPreview();
      return;
    }
    if (!preview.canConfirm) {
      setMessage("当前识别结果还不能确认入库，请先按提示补充或更换文件。");
      setUploadError(null);
      return;
    }
    await confirmUpload();
  }

  const hasProgress = progress.step !== "idle" || loading || preview || files.length > 0;
  const progressPercent = Math.max(0, Math.min(100, progress.percent || 0));
  const progressLabel = loading ? progress.text : confirmed ? "已完成入库" : progress.text;
  const canCloseUpload = !loading;
  const canEditUploadFiles = !loading && !confirmed;
  const uploadTargetName = needsProject ? targetProject?.name || "当前项目" : values["项目名称"] || "新项目";
  const uploadNextAction = loading
    ? "后台处理中，完成前不用重复提交"
    : confirmed
      ? "已完成，可以回到项目大盘查看"
      : preview?.canConfirm
        ? "点开后确认入库"
        : preview
          ? "点开后处理识别提示"
          : files.length
            ? "点开后开始 AI 预览识别"
            : "等待选择文件";

  if (minimized) {
    return (
      <div className="upload-mini-panel">
        <button type="button" className="upload-mini-main" onClick={onExpand}>
          <UploadCloud size={17} />
          <span>
            <strong>{loading ? "AI 正在识别文件" : preview ? "识别结果待确认" : "上传任务已收起"}</strong>
            <em>{progressLabel}</em>
          </span>
        </button>
        <div className="upload-mini-meta">
          <span>{typeLabels[type]}</span>
          <span>{uploadTargetName} · {files.length} 个文件</span>
          <b>{uploadNextAction}</b>
        </div>
        <div className="upload-mini-progress"><i style={{ width: `${progressPercent}%` }} /></div>
        <button type="button" className="ghost tiny" onClick={onExpand}>打开</button>
      </div>
    );
  }

  return createPortal(
    <div className="modal-backdrop">
      <form className="upload-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>{needsProject ? `上传到「${targetProject?.name || "当前项目"}」` : "上传合同创建项目"}</h2>
            <p>{needsProject ? "先 AI 预览识别，确认后才会写入当前项目。" : "合同/报价表会先预览，确认后创建项目。"}</p>
            {hasProgress && (
              <div className="upload-head-progress">
                <span>{progressLabel}</span>
                <b>{progressPercent}%</b>
                <i style={{ width: `${progressPercent}%` }} />
              </div>
            )}
          </div>
          <div className="modal-head-actions">
            {preview && !confirmed && (
              <div className="upload-head-review-actions">
                <button type="button" className="ghost" onClick={showPreview}>查看识别结果</button>
                <button type="button" className="ghost" onClick={requestPreview} disabled={loading}>重新预览</button>
                <button type="button" className="primary" onClick={confirmUpload} disabled={loading || !preview.canConfirm}>{loading ? "处理中" : "确认入库"}</button>
              </div>
            )}
            {hasProgress && <button type="button" className="ghost" onClick={onMinimize}><Minimize2 size={15} />缩到后台继续</button>}
            {canCloseUpload
              ? <button type="button" className="ghost" onClick={onClose}>关闭</button>
              : <button type="button" className="ghost" onClick={onMinimize}>处理中，缩到后台</button>}
          </div>
        </div>

        <div className="upload-modal-body" ref={bodyRef} tabIndex="0" aria-label="上传内容与 AI 识别结果，可上下滚动">
          <label>
            <span>上传类型</span>
            <select value={type} onChange={(event) => {
              setType(event.target.value);
              setPreview(null);
              setConfirmed(false);
              setMessage("");
              setUploadError(null);
            }}>
              {typeOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          {!canUseCreateProject && <p className="upload-context-note">你的账号不能创建新项目；可以把成本表、报价表、核销表上传到自己可见的项目。</p>}
          {needsProject && <p className="upload-context-note">已按当前项目预选：{typeLabels[type]}。AI 预览确认前不会写入项目。</p>}

          {needsProject && hasProjects && (
            <label>
              <span>归属项目</span>
              <select value={projectId} onChange={(event) => {
                setProjectId(event.target.value);
                setPreview(null);
                setConfirmed(false);
                setMessage("");
                setUploadError(null);
              }}>
                {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}

          {type === "create-project" && (
            <div className="form-grid">
              {Object.keys(values).map((key) => (
                <label key={key}>
                  <span>{key}</span>
                  <input value={values[key]} onChange={(event) => {
                    setValues({ ...values, [key]: event.target.value });
                    setPreview(null);
                    setConfirmed(false);
                    setUploadError(null);
                  }} placeholder={key === "项目名称" ? "可留空，由 AI 从合同识别" : ""} />
                </label>
              ))}
            </div>
          )}

          <label className="file-drop" onDrop={dropFiles} onDragOver={(event) => event.preventDefault()}>
            <UploadCloud size={18} />
            <strong>{files.length ? `已选择 ${files.length} 个文件` : `选择${needsProject ? typeLabels[type].replace("已有项目：", "") : "合同、报价表"}文件`}</strong>
            <span>{needsProject && targetProject ? `归属项目：${targetProject.name}。` : ""}支持 PDF / Word / Excel / CSV / 图片。大 PDF 请耐心等待 OCR。</span>
            <input type="file" multiple onChange={pickFiles} />
          </label>

          {hasProgress && <UploadProgressPanel
            loading={loading}
            confirmed={confirmed}
            preview={preview}
            progressLabel={progressLabel}
            progressPercent={progressPercent}
            fileCount={files.length}
          />}

          {files.length > 0 && (
            <div className="file-list">
              {files.map((file) => (
                <div key={`${file.name}-${file.size}`}>
                  <strong>{file.name}</strong>
                  <span>{fileSize(file.size)}</span>
                  <button type="button" className="ghost tiny" disabled={!canEditUploadFiles} onClick={() => removeFile(uploadedFileKey(file))}>{loading ? "处理中" : "移除"}</button>
                </div>
              ))}
            </div>
          )}

          {preview && <div ref={previewRef} className="upload-preview-anchor"><UploadPreview preview={preview} /></div>}

          {message && <p className="form-message">{message}</p>}
          {uploadError && <UploadErrorHint error={uploadError} />}
        </div>
        <div className="modal-actions upload-action-dock">
          <div className="upload-action-status">
            <strong>{progressLabel}</strong>
            <span>{uploadNextAction}</span>
          </div>
          <div className="upload-action-buttons">
            {canCloseUpload
              ? <button type="button" className="ghost" onClick={onClose}>取消</button>
              : <button type="button" className="ghost" onClick={onMinimize}>处理中，缩到后台</button>}
            {hasProgress && <button type="button" className="ghost" onClick={onMinimize}>缩到后台继续</button>}
            {preview && <button type="button" className="ghost" onClick={showPreview}>查看识别结果</button>}
            {preview && !confirmed && <button type="button" className="ghost" onClick={requestPreview} disabled={loading}>重新预览</button>}
            <button type="submit" className="primary" disabled={loading || (preview && !preview.canConfirm)}>{loading ? "处理中" : preview ? "确认入库" : "AI 预览识别"}</button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  );
}

function UploadProgressPanel({ loading, confirmed, preview, progressLabel, progressPercent, fileCount = 0 }) {
  const title = loading ? "AI 正在处理" : confirmed ? "处理完成" : preview ? "等待确认" : fileCount ? "文件已加入任务" : "准备识别";
  return (
    <div className="upload-progress-panel">
      <div>
        <strong>{title}</strong>
        <span>{progressLabel}</span>
      </div>
      {fileCount > 0 && !loading && !preview && !confirmed && <p>已放入 {fileCount} 个文件。现在可以点下面的「AI 预览识别」，预览完成前不会写入项目。</p>}
      <div className="upload-progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
      <ol>
        {["读取文件", "AI/OCR识别", "预览确认", "写入项目"].map((step, index) => (
          <li className={progressPercent >= [12, 62, 82, 100][index] ? "done" : ""} key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function UploadErrorHint({ error }) {
  if (!error) return null;
  return (
    <div className="upload-error-hint">
      <div>
        <AlertTriangle size={16} />
        <strong>{error.title}</strong>
      </div>
      <p>{error.detail}</p>
      <span>{error.next}</span>
    </div>
  );
}

function UploadPreview({ preview }) {
  const fieldEntries = Object.entries(preview.fields || {}).filter(([, value]) => value !== "" && value !== undefined && value !== null);
  return (
    <section className="upload-preview">
      <div className="preview-head">
        <div>
          <strong>AI 识别结果确认</strong>
          <span>{preview.summary}</span>
        </div>
        <b className={preview.canConfirm ? "ok" : "danger"}>{preview.canConfirm ? "可确认" : "需处理"}</b>
      </div>
      <div className="preview-progress-note">
        <strong>{preview.canConfirm ? "识别已完成，正在等待你确认入库。" : "识别已完成，但还有信息需要处理。"}</strong>
        <span>这个预览阶段不会写入项目；长表格会在弹窗内自动换行，不需要拖动整个页面找按钮。</span>
      </div>

      {!!preview.targetProject && (
        <div className="preview-target">
          <span>归属项目</span>
          <strong>{preview.targetProject.name}</strong>
        </div>
      )}

      {!!fieldEntries.length && (
        <div className="preview-fields">
          {fieldEntries.map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{typeof value === "number" ? money(value) : value}</strong>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(preview.warnings) && preview.warnings.length > 0 && (
        <div className="preview-warnings">
          {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      {(preview.sections || []).map((section) => {
        const rows = section.rows || [];
        const visibleRows = rows.slice(0, 8);
        const hiddenCount = Math.max(rows.length - visibleRows.length, 0);
        return (
          <div className="preview-section" key={section.title}>
            <div className="preview-section-head">
              <strong>{section.title}</strong>
              {section.total ? <span>合计 {money(section.total)}</span> : null}
            </div>
            <div className="preview-table">
              {visibleRows.map((row, index) => (
                <div key={`${section.title}-${index}`}>
                  <strong title={row.name || row.matched || "未命名项"}>{row.name || row.matched || "未命名项"}</strong>
                  <p>
                    <span>{row.quantity ? `${row.quantity}${row.unit || ""}` : row.status || "待确认"}</span>
                    <b>{row.amount || row.unitPrice ? money(row.amount || row.unitPrice) : row.detail || "已归类"}</b>
                  </p>
                </div>
              ))}
              {hiddenCount > 0 && (
                <div className="preview-table-more">
                  <strong>还识别到 {hiddenCount} 条明细</strong>
                  <p>
                    <span>为避免预览过长，这里先展示前 8 条。</span>
                    <b>确认入库会按完整识别结果处理</b>
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
