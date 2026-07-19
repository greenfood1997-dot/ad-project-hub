import { money, textIncludes } from "./service-utils.mjs";
import { inferExpenseCategory } from "./approval-flow.mjs";
import { amountFromAssistantText, assistantApprovalTypeFromText, assistantFilingIntentFromText, assistantMetrics, assistantPendingActionMatches, assistantProjectContext, assistantRunway, assistantSafeSettings, findAssistantProject, parseAssistantTaskDraft, simpleProjectHealth } from "./assistant-rules.mjs";

// AI assistant orchestration and write-action confirmation helpers.
function requireAssistantDep(deps, key) {
  if (typeof deps[key] !== "function") throw new Error(`AI助手服务缺少依赖：${key}`);
  return deps[key];
}

async function requestAssistantAiReply(db, { query, user, scopedDb, target, fallbackReply }, deps = {}) {
  const ai = requireAssistantDep(deps, "resolveAiSettings")(db.settings?.aiService || {});
  if (!ai?.["API Key"]) return null;
  const url = `${ai["Base URL"].replace(/\/$/, "")}/chat/completions`;
  const metrics = assistantMetrics(scopedDb);
  const visibleProjects = (scopedDb.projects || []).slice(0, 8).map((project) => ({
    name: project.name,
    client: project.client,
    status: project.status,
    progress: project.progress,
    contract: Number(project.contract || 0),
    paid: Number(project.paid || 0),
    receivable: Number(project.receivable || 0),
    costUsed: Number(project.costUsed || 0)
  }));
  const messages = [
    {
      role: "system",
      content: [
        "你是广告公司内部 OA 的 AI 项目伙伴，回答要像靠谱同事，简洁、具体、会说人话。",
        "你只能根据用户可见项目和已授权数据回答，不要编造不可见项目、密钥、利润明细或公司现金流。",
        "普通员工不能看到公司经营现金流、全公司利润、密钥或非自己项目；遇到敏感问题要礼貌说明权限。",
        "不要直接承诺已经写入数据。报销、备用金、供应商付款、成本写入等动作必须走系统确认流程。",
        "输出纯文本，不要 Markdown 表格。优先给 1-3 条具体下一步。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户：${user.name} / 角色：${user.role}`,
        `问题：${query}`,
        `当前匹配项目：\n${assistantProjectContext(target) || "无"}`,
        `可见项目摘要：${JSON.stringify(visibleProjects)}`,
        `可见经营汇总：${JSON.stringify(metrics)}`,
        `安全设置摘要：${JSON.stringify(assistantSafeSettings(scopedDb.settings || db.settings || {}))}`,
        `系统规则兜底回答：${fallbackReply}`
      ].join("\n\n")
    }
  ];
  const res = await requireAssistantDep(deps, "postAi")(url, ai["API Key"], {
    model: ai["模型名称"] || "deepseek-chat",
    temperature: 0.4,
    messages
  });
  if (!res.ok) throw new Error(`AI 服务返回 ${res.res.status}：${res.detail || "请求失败"}`);
  const data = await res.res.json();
  return String(data.choices?.[0]?.message?.content || "").trim().slice(0, 1600);
}

function answerAiAssistantByRules(db, body, user, scopedDb, deps = {}) {
  const query = String(body?.query || "").trim();
  if (!query) throw new Error("先输入一个问题");
  const projects = scopedDb.projects || [];
  const target = findAssistantProject(query, projects, body?.selectedProjectId);
  if (!target) {
    return {
      reply: "你当前还没有可见项目。请让管理员或总监先把你加入项目，分派后我就能回答进度、备用金、报销和文件归档。",
      action: "empty-projects"
    };
  }

  const amount = amountFromAssistantText(query);
  if (amount && /(提交|申请|登记|记录|记一笔|报销|备用金|费用|花了|支出)/.test(query)) {
    const type = assistantApprovalTypeFromText(query);
    if (type) {
      const category = type === "reimbursement" ? inferExpenseCategory({ reason: query, payee: user.name }) : null;
      const pendingAction = {
        kind: "create-approval",
        projectId: target.id,
        projectName: target.name,
        type,
        typeLabel: type === "petty_cash" ? "项目备用金" : "报销",
        amount,
        payee: user.name,
        reason: query,
        expenseCategory: category?.category || "",
        requiresVoucher: type === "reimbursement"
      };
      if (!assistantPendingActionMatches(body?.confirmAction, pendingAction, ["projectId", "type", "amount"])) {
        return {
          reply: `我理解你要给「${target.name}」提交${pendingAction.typeLabel}申请，金额 ${money(amount)}${pendingAction.expenseCategory ? `，类目 ${pendingAction.expenseCategory}` : ""}。${type === "reimbursement" ? "请先选择提供发票、支付截图或暂未提供凭证，" : ""}确认后我再提交。`,
          action: "approval-confirmation-required",
          pendingAction
        };
      }
      const confirmedAction = body.confirmAction || {};
      const approval = requireAssistantDep(deps, "createApproval")(db, {
        ...pendingAction,
        voucherType: confirmedAction.voucherType,
        invoiceNo: confirmedAction.invoiceNo,
        transactionNo: confirmedAction.transactionNo,
        voucherNote: confirmedAction.voucherNote
      }, user);
      return {
        reply: `已帮你提交「${target.name}」的${pendingAction.typeLabel}申请，金额 ${money(amount)}${approval.expenseCategory ? `，类目 ${approval.expenseCategory}` : ""}。当前状态：${approval.status}。`,
        action: "approval-created",
        approval
      };
    }
  }

  const taskDraft = parseAssistantTaskDraft(query, user);
  if (taskDraft) {
    const pendingAction = {
      kind: "create-task",
      projectId: target.id,
      projectName: target.name,
      title: taskDraft.title,
      owner: taskDraft.owner,
      dueDate: taskDraft.dueDate,
      progress: taskDraft.progress,
      note: taskDraft.note
    };
    if (!assistantPendingActionMatches(body?.confirmAction, pendingAction, ["projectId", "title", "owner", "dueDate", "progress"])) {
      return {
        reply: `我理解你要给「${target.name}」新增任务「${taskDraft.title}」${taskDraft.dueDate ? `，截止 ${taskDraft.dueDate}` : ""}${taskDraft.owner ? `，负责人 ${taskDraft.owner}` : ""}。确认后我会写入项目进度，不会直接影响财务数据。`,
        action: "task-confirmation-required",
        pendingAction
      };
    }
    const result = requireAssistantDep(deps, "upsertProjectTask")(db, pendingAction, user);
    return {
      reply: `已给「${target.name}」新增任务「${result.task.title}」，项目进度已刷新到 ${result.project.progress || 0}%。`,
      action: "task-created",
      task: result.task,
      project: result.project
    };
  }

  const pettyBudget = Number(target.pettyCashBudget || target.extractedFields?.pettyCashBudget || target.extractedFields?.projectPettyCashBudget || 0);
  const pettyUsed = Number(target.pettyCashUsed || target.extractedFields?.pettyCashUsed || target.extractedFields?.projectPettyCashUsed || 0);
  if (/备用金|预算/.test(query)) {
    return {
      reply: `「${target.name}」备用金预算 ${money(pettyBudget)}，已使用 ${money(pettyUsed)}，当前剩余 ${money(Math.max(pettyBudget - pettyUsed, 0))}。`,
      action: "petty-cash"
    };
  }
  if (assistantFilingIntentFromText(query)) {
    const explicitMatches = projects.filter((project) => textIncludes(query, project.name) || textIncludes(query, project.client));
    return {
      reply: !explicitMatches.length && projects.length > 1
        ? `我识别到你有 ${projects.length} 个可见项目。为了避免成本记错账，请在上传入口选择项目；如果你直接说项目名，比如“这个统计到${target.name}成本里”，我会按项目匹配。`
        : `当前匹配项目是「${target.name}」。我会引导你打开上传入口，文件会先 AI 预览；如果是报销表，会按内部报销明细预览，确认后才进入项目成本。`,
      action: "filing-guidance"
    };
  }
  if (/报销|票据|审批/.test(query)) {
    const rows = (scopedDb.approvals || []).filter((item) => item.projectId === target.id || item.projectName === target.name);
    return {
      reply: rows.length
        ? `「${target.name}」共有 ${rows.length} 条审批：${rows.slice(0, 3).map((item) => `${item.typeLabel || item.type} ${money(item.amount)} ${item.status}`).join("；")}。`
        : `「${target.name}」当前没有审批记录。你可以说“帮我提交 500 元报销到${target.name}”，我会先生成待确认审批，确认后再提交。`,
      action: "approval-summary"
    };
  }
  if (/回款|收款|催收|待收|尾款|首款/.test(query)) {
    const contract = Number(target.contract || 0);
    const paid = Number(target.paid || 0);
    const receivable = Number(target.receivable || Math.max(contract - paid, 0));
    const rate = contract ? Math.round((paid / contract) * 100) : 0;
    return {
      reply: `「${target.name}」合同 ${money(contract)}，已回款 ${money(paid)}，待回款 ${money(receivable)}，回款率 ${rate}%。建议围绕「${target.paymentDue || "待确认回款节点"}」温和确认付款安排。`,
      action: "collection-context"
    };
  }
  if (/创意|内容|过稿|脚本/.test(query)) {
    return {
      reply: `针对「${target.client || target.name}」，建议先给真实使用场景，再给客户能确认的执行路径，减少空概念。可以把历史反馈继续上传，我会沉淀客户偏好和雷区。`,
      action: "content-idea"
    };
  }
  if (/进度|节点|滞后|超前|完成度/.test(query)) {
    const health = simpleProjectHealth(target);
    return {
      reply: `「${target.name}」当前完成度 ${health.completion}%，时间进度 ${health.timeProgress}%，AI 判断为${health.label}。${health.text}`,
      action: "progress"
    };
  }
  if (/现金流|经营|倒闭|安全线|老板|公司/.test(query)) {
    if (!["shareholder", "admin", "director", "finance"].includes(user.role)) {
      return {
        reply: "公司经营和现金流属于管理层可见内容。你可以继续问自己项目的进度、备用金、报销和材料状态。",
        action: "management-denied"
      };
    }
    const metrics = assistantMetrics(scopedDb);
    const runway = assistantRunway(scopedDb.settings || db.settings || {});
    return {
      reply: `公司经营判断：${runway.label}。待回款 ${money(metrics.receivable)}，待审批 ${metrics.pendingApprovals.length} 条，现金可撑 ${runway.monthlyFixedCost ? `${runway.runwayMonths.toFixed(1)}个月` : "待设置"}，6个月安全线缺口 ${money(runway.gap)}。`,
      action: "management-advice"
    };
  }
  if (/我的项目|有哪些项目/.test(query)) {
    return {
      reply: `你当前可见 ${projects.length} 个项目：${projects.slice(0, 5).map((project) => `${project.name}(${simpleProjectHealth(project).label})`).join("、")}。`,
      action: "project-list"
    };
  }
  return {
    reply: `我先按当前项目「${target.name}」理解：进度 ${Number(target.progress || 0)}%，下一节点是「${target.nextMilestone || "待确认"}」。你可以问“我的项目备用金还有多少”，也可以说“帮我提交 500 元报销到${target.name}”。`,
    action: "fallback"
  };
}

export async function answerAiAssistant(db, body, user, scopedDb, deps = {}) {
  const rules = answerAiAssistantByRules(db, body, user, scopedDb, deps);
  if (rules.pendingAction || ["approval-created", "task-created"].includes(rules.action)) return rules;
  if (["management-denied", "empty-projects"].includes(rules.action)) return rules;
  if ([
    "petty-cash",
    "approval-summary",
    "collection-context",
    "progress",
    "management-advice",
    "project-list",
    "filing-guidance"
  ].includes(rules.action)) return rules;
  try {
    const target = findAssistantProject(body?.query, scopedDb.projects || [], body?.selectedProjectId);
    const reply = await requestAssistantAiReply(db, {
      query: String(body?.query || "").trim(),
      user,
      scopedDb,
      target,
      fallbackReply: rules.reply
    }, deps);
    if (reply) {
      return {
        ...rules,
        reply,
        aiGenerated: true,
        action: rules.action === "fallback" ? "ai-chat" : rules.action
      };
    }
  } catch (error) {
    return {
      ...rules,
      aiGenerated: false,
      aiFallbackReason: error.message
    };
  }
  return rules;
}
