import {
  BarChart3,
  BellRing,
  Bot,
  FileSpreadsheet,
  LayoutDashboard,
  MessageSquareText,
  MessagesSquare,
  UsersRound
} from "lucide-react";

export function dashboardNavGroups({ canUseCollection = false, isManagement = false } = {}) {
  return [
    {
      key: "dashboard",
      icon: LayoutDashboard,
      label: "项目工作台",
      children: [
        ["dashboard", "项目大盘"],
        ["my-projects", "我的项目"]
      ]
    },
    {
      key: "ai",
      icon: Bot,
      label: "AI 助手"
    },
    {
      key: "approvals",
      icon: BellRing,
      label: "审批与备用金",
      children: [
        ["approvals", "待我审批"],
        ["approvals", "项目备用金"],
        ["approvals", "报销"],
        ["approvals", "供应商付款"]
      ]
    },
    {
      key: "closeout",
      icon: FileSpreadsheet,
      label: "成本复盘",
      children: [
        ["closeout", "结案复盘"],
        ["closeout", "支出排行"]
      ]
    },
    {
      key: "suppliers",
      icon: UsersRound,
      label: "供应商库"
    },
    {
      key: "clients",
      icon: MessageSquareText,
      label: "客户偏好"
    },
    ...(canUseCollection ? [{
      key: "collections",
      icon: MessagesSquare,
      label: "催收助手"
    }] : []),
    ...(isManagement ? [{
      key: "management",
      icon: BarChart3,
      label: "经营舱",
      children: [
        ["management", "公司大盘"],
        ["management", "现金流压力"],
        ["management", "AI 商业顾问"]
      ]
    }] : [])
  ];
}
