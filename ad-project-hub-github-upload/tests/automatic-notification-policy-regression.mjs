import assert from "node:assert/strict";
import { dispatchNewHighSeverityNotifications } from "../server/services.mjs";

function makeDb(alertSettings) {
  return {
    settings: {
      alertSettings,
      feishu: { mockSend: "true" },
      wechat: { webhookUrl: "https://example.test/mock", mockSend: "true" }
    },
    users: [{ id: "u-pm", name: "项目经理", email: "pm@example.test", role: "pm", status: "active", feishuOpenId: "ou_pm" }],
    projects: [{ id: "p-1", name: "自动提醒项目", pm: "项目经理", tasks: [] }],
    auditLogs: [],
    systemNotifications: [{
      id: "notice-high", status: "待处理", severity: "高", title: "项目进度滞后", text: "需要处理", projectId: "p-1", projectName: "自动提醒项目", recipients: ["pm"]
    }, {
      id: "notice-medium", status: "待处理", severity: "中", title: "普通提醒", text: "留在 OA", projectId: "p-1", projectName: "自动提醒项目", recipients: ["pm"]
    }]
  };
}

const disabledDb = makeDb({ autoNotifyEnabled: false, autoNotifyChannels: ["feishu", "wechat"] });
const disabled = await dispatchNewHighSeverityNotifications(disabledDb, disabledDb.systemNotifications, { id: "scheduler", name: "后台定时巡检" });
assert.equal(disabled.attempted, 0, "默认关闭时不应发送外部提醒");
assert.equal(disabledDb.systemNotifications[0].autoDelivery, undefined, "关闭时不应写入自动发送记录");

const enabledDb = makeDb({ autoNotifyEnabled: true, autoNotifyChannels: ["feishu", "wechat"] });
const enabled = await dispatchNewHighSeverityNotifications(enabledDb, enabledDb.systemNotifications, { id: "scheduler", name: "后台定时巡检" });
assert.equal(enabled.attempted, 2, "开启后高风险新待办应按选中渠道发送");
assert.equal(enabled.sent, 2, "模拟飞书和企业微信发送应成功");
assert.equal(enabledDb.systemNotifications[0].autoDelivery.channels.feishu.ok, true, "高风险待办应记录飞书自动发送结果");
assert.equal(enabledDb.systemNotifications[0].autoDelivery.channels.wechat.ok, true, "高风险待办应记录企业微信自动发送结果");
assert.equal(enabledDb.systemNotifications[0].feishuDelivery.source, "automatic", "飞书记录应区分自动发送");
assert.equal(enabledDb.systemNotifications[0].wechatDelivery.source, "automatic", "企业微信记录应区分自动发送");
assert.equal(enabledDb.systemNotifications[1].autoDelivery, undefined, "中风险待办不应自动外发");

const nextRound = await dispatchNewHighSeverityNotifications(enabledDb, [], { id: "scheduler", name: "后台定时巡检" });
assert.equal(nextRound.attempted, 0, "下一轮没有新待办时不应重复发送");

console.log("automatic notification policy regression passed");
