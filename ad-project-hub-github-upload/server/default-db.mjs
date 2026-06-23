export const defaultDb = {
  users: [
    { id: "u-shareholder", name: "公司股东", email: "owner@company.local", role: "shareholder", department: "管理层", status: "active", pin: "123456" },
    { id: "u-admin", name: "中台管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-director", name: "项目总监", email: "director@company.local", role: "director", department: "项目部", status: "active", pin: "123456" },
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-sales", name: "销售成员", email: "sales@company.local", role: "sales", department: "销售部", status: "active", pin: "123456" },
    { id: "u-finance", name: "财务成员", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-member", name: "普通员工", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    aiService: null,
    feishu: null,
    wechat: null,
    baseSettings: null,
    collabSettings: null,
    alertSettings: null,
    interestRate: {
      source: "latest_lpr",
      annualRate: 3.45,
      spread: 0,
      fallbackRate: 3.45,
      term: "1Y",
      updatedAt: null,
      note: "默认使用 1 年期 LPR；联网刷新失败时使用兜底年化利率。"
    }
  },
  projects: [],
  suppliers: [],
  approvals: [],
  files: [],
  parseJobs: [],
  alertUpdates: [],
  comments: [],
  auditLogs: []
};
