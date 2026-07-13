import React from "react";
import { FileText, UploadCloud, UserCog } from "lucide-react";

export default function EmptyProjectState({ isManagement, isAdmin, canManageAssignments, canCreateProject, onUpload, onAdmin, onAssignments, PanelTitle }) {
  return (
    <section className="empty-project-state">
      <div>
        <PanelTitle icon={FileText} title="还没有真实项目" />
        <h2>{canCreateProject ? "先上传第一份合同或报价表，OA 才会开始生成项目数据。" : "你当前还没有被分派到项目。"}</h2>
        <p>{canCreateProject
          ? (isManagement ? "上传后会自动进入项目台账、审批、回款、成本复盘和经营舱统计。" : "上传后可以进入我的项目继续归集成本、核销和审批。")
          : "请让管理员或总监在后台的项目分派里把你加入项目；分派后这里会自动出现你的项目进度、任务、备用金和上传入口。"}</p>
        <div className="button-row">
          {canCreateProject && <button type="button" className="primary" onClick={onUpload}><UploadCloud size={16} />上传合同创建项目</button>}
          {isAdmin && <button type="button" className="ghost" onClick={onAdmin}><UserCog size={16} />成员与权限</button>}
          {canManageAssignments && <button type="button" className="ghost" onClick={onAssignments}><UserCog size={16} />项目分派</button>}
        </div>
      </div>
      <div className="empty-steps">
        {canCreateProject ? <>
          <div><strong>1</strong><span>上传合同 / 报价表</span></div>
          <div><strong>2</strong><span>AI 预览识别字段</span></div>
          <div><strong>3</strong><span>确认入库生成项目</span></div>
          <div><strong>4</strong><span>审批、回款、成本复盘开始流转</span></div>
        </> : <>
          <div><strong>1</strong><span>联系管理员分派项目</span></div>
          <div><strong>2</strong><span>进入我的项目工作台</span></div>
          <div><strong>3</strong><span>上传成本 / 核销 / 报销</span></div>
          <div><strong>4</strong><span>查看进度、任务和 AI 提醒</span></div>
        </>}
      </div>
    </section>
  );
}
