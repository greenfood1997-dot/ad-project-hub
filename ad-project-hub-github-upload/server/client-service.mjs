import { money, splitLines } from "./service-utils.mjs";

function clientProfileFor(db, clientName) {
  db.clientProfiles = db.clientProfiles || [];
  const client = String(clientName || "").trim();
  let profile = db.clientProfiles.find((item) => item.client === client);
  if (!profile) {
    profile = { client, likes: [], dislikes: [], pitfalls: [], handoffNote: "", contactStyle: "", updatedAt: new Date().toISOString() };
    db.clientProfiles.unshift(profile);
  }
  profile.likes = Array.isArray(profile.likes) ? profile.likes : splitLines(profile.likes);
  profile.dislikes = Array.isArray(profile.dislikes) ? profile.dislikes : splitLines(profile.dislikes);
  profile.pitfalls = Array.isArray(profile.pitfalls) ? profile.pitfalls : splitLines(profile.pitfalls);
  return profile;
}

function clientHandoffPackage({ profile = {}, projects = [], comments = [], pitfalls = [] }) {
  const activeProjects = projects.filter((project) => !/已完成|已结案|关闭|取消|作废/.test(String(project.status || "")));
  const receivableProjects = projects
    .filter((project) => Number(project.receivable || 0) > 0)
    .sort((a, b) => Number(b.receivable || 0) - Number(a.receivable || 0));
  const latestProject = [...projects].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
  const latestComments = comments
    .slice()
    .sort((a, b) => new Date(b.at || b.createdAt || 0) - new Date(a.at || a.createdAt || 0))
    .slice(0, 3)
    .map((comment) => String(comment.body || comment.text || "").trim())
    .filter(Boolean);
  const totalReceivable = receivableProjects.reduce((sum, project) => sum + Number(project.receivable || 0), 0);
  const mustAvoid = pitfalls.slice(0, 5);
  const firstActions = [];
  if (activeProjects.length) firstActions.push(`先确认在执行项目：${activeProjects.slice(0, 3).map((project) => `${project.name}（${project.status || "状态待补"}）`).join("、")}`);
  if (receivableProjects.length) firstActions.push(`优先跟进回款：${receivableProjects[0].name} 待回款 ${money(receivableProjects[0].receivable)}`);
  if (mustAvoid.length) firstActions.push(`沟通前先避开雷区：${mustAvoid.slice(0, 2).join("；")}`);
  if (profile.handoffNote) firstActions.push(`先读交接备注：${String(profile.handoffNote).split(/\n/).filter(Boolean)[0]}`);
  if (!firstActions.length) firstActions.push("先补充客户偏好、雷区、最近项目状态和回款节点。");

  return {
    title: `${profile.client || "客户"} PM 自动交接包`,
    activeProjectCount: activeProjects.length,
    activeProjects: activeProjects.map((project) => ({
      id: project.id || "",
      name: project.name,
      status: project.status || "",
      owner: project.pm || project.owner || "",
      receivable: Number(project.receivable || 0),
      paymentDue: project.paymentDue || ""
    })).slice(0, 5),
    latestProject: latestProject ? {
      id: latestProject.id || "",
      name: latestProject.name,
      status: latestProject.status || "",
      owner: latestProject.pm || latestProject.owner || "",
      receivable: Number(latestProject.receivable || 0),
      paymentDue: latestProject.paymentDue || ""
    } : null,
    receivableProjects: receivableProjects.map((project) => ({
      id: project.id || "",
      name: project.name,
      amount: Number(project.receivable || 0),
      paymentDue: project.paymentDue || ""
    })).slice(0, 5),
    totalReceivable,
    likes: (profile.likes || []).slice(0, 5),
    dislikes: (profile.dislikes || []).slice(0, 5),
    mustAvoid,
    contactStyle: profile.contactStyle || "",
    firstActions,
    latestFeedback: latestComments,
    handoffNote: profile.handoffNote || "",
    summary: [
      activeProjects.length ? `在执行 ${activeProjects.length} 个项目` : "暂无在执行项目",
      totalReceivable ? `待回款 ${money(totalReceivable)}` : "暂无待回款",
      mustAvoid.length ? `雷区 ${mustAvoid.length} 条` : "雷区待沉淀",
      profile.contactStyle ? `沟通风格：${profile.contactStyle}` : ""
    ].filter(Boolean).join("；")
  };
}

export function clientLibrary(db) {
  const profiles = new Map((db.clientProfiles || []).map((item) => [item.client, {
    ...item,
    likes: splitLines(item.likes),
    dislikes: splitLines(item.dislikes),
    pitfalls: splitLines(item.pitfalls)
  }]));
  for (const project of db.projects || []) {
    const client = String(project.client || project.brand || project.name || "").trim();
    if (!client) continue;
    if (!profiles.has(client)) profiles.set(client, { client, likes: [], dislikes: [], pitfalls: [], handoffNote: "", contactStyle: "", updatedAt: "" });
  }
  return Array.from(profiles.values()).map((profile) => {
    const projects = (db.projects || []).filter((project) => String(project.client || project.brand || project.name || "").trim() === profile.client);
    const comments = (db.comments || []).filter((comment) => projects.some((project) => project.name === comment.project));
    const totalContract = projects.reduce((sum, project) => sum + Number(project.contract || 0), 0);
    const receivable = projects.reduce((sum, project) => sum + Number(project.receivable || 0), 0);
    const latestProject = [...projects].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
    const inferredPitfalls = comments
      .map((comment) => String(comment.body || ""))
      .filter((text) => /雷区|不要|被骂|客户不喜欢|驳回|吐槽|差评|不满意/.test(text))
      .slice(0, 5);
    const pitfalls = Array.from(new Set([...profile.pitfalls, ...inferredPitfalls]));
    const handoffPackage = clientHandoffPackage({ profile: { ...profile, client: profile.client }, projects, comments, pitfalls });
    return {
      ...profile,
      pitfalls,
      projectCount: projects.length,
      projects: projects.map((project) => project.name),
      totalContract,
      receivable,
      latestProject: latestProject?.name || "",
      latestStatus: latestProject?.status || "",
      commentCount: comments.length,
      handoffPackage,
      handoffSummary: [
        profile.likes.length ? `客户偏好：${profile.likes.slice(0, 3).join("；")}` : "",
        pitfalls.length ? `注意雷区：${pitfalls.slice(0, 3).join("；")}` : "",
        profile.handoffNote ? `交接备注：${profile.handoffNote}` : "",
        latestProject ? `最近项目：${latestProject.name}（${latestProject.status || "状态待补"}）` : ""
      ].filter(Boolean).join("。") || "暂无客户偏好沉淀，建议 PM 在项目动态中记录客户反馈。"
    };
  }).sort((a, b) => b.projectCount - a.projectCount || b.totalContract - a.totalContract);
}

export function saveClientProfile(db, body, user) {
  const client = String(body.client || "").trim();
  if (!client) throw new Error("请填写客户名称");
  const at = new Date().toISOString();
  const profile = clientProfileFor(db, client);
  const appendMode = body.append === true || body.append === "true";
  if (appendMode) {
    profile.likes = Array.from(new Set([...(profile.likes || []), ...splitLines(body.likes)]));
    profile.dislikes = Array.from(new Set([...(profile.dislikes || []), ...splitLines(body.dislikes)]));
    profile.pitfalls = Array.from(new Set([...(profile.pitfalls || []), ...splitLines(body.pitfalls)]));
    const nextHandoff = String(body.handoffNote || "").trim();
    profile.handoffNote = [profile.handoffNote, nextHandoff].filter(Boolean).join("\n");
  } else {
    profile.likes = splitLines(body.likes ?? profile.likes);
    profile.dislikes = splitLines(body.dislikes ?? profile.dislikes);
    profile.pitfalls = splitLines(body.pitfalls ?? profile.pitfalls);
    profile.handoffNote = String(body.handoffNote ?? profile.handoffNote ?? "").trim();
  }
  profile.contactStyle = String(body.contactStyle ?? profile.contactStyle ?? "").trim();
  profile.updatedAt = at;
  db.auditLogs.unshift({
    type: "client",
    target: client,
    action: "profile",
    user: user.name,
    meta: { likes: profile.likes.length, pitfalls: profile.pitfalls.length },
    at
  });
  return clientLibrary(db).find((item) => item.client === client);
}
