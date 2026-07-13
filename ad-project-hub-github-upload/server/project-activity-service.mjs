function fileArchiveMatches(file = {}, body = {}) {
  if (body.fileId && file.id === body.fileId) return true;
  const name = String(body.fileName || body.name || "").trim();
  const uploadedAt = String(body.uploadedAt || "").trim();
  if (!name || file.name !== name) return false;
  if (uploadedAt && file.uploadedAt !== uploadedAt) return false;
  return true;
}

function nextCommentId() {
  return `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function archiveFileRecord(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body.projectId || item.name === body.projectName);
  if (!project) throw new Error("项目不存在");
  const at = new Date().toISOString();
  let archivedFile = null;
  let archivedUpload = null;
  db.files = db.files || [];
  for (const upload of db.files) {
    const matchesProject = upload.projectId === project.id || upload.projectName === project.name;
    if (!matchesProject) continue;
    upload.files = (upload.files || []).map((file) => {
      if (archivedFile || file.archivedAt || !fileArchiveMatches(file, body)) return file;
      archivedFile = {
        ...file,
        archivedAt: at,
        archivedBy: user.id,
        archivedByName: user.name,
        archiveReason: String(body.reason || "").trim() || "文件归档纠错"
      };
      archivedUpload = upload;
      return archivedFile;
    });
  }
  if (!archivedFile) {
    for (const file of project.files || []) {
      if (archivedFile || file.archivedAt || !fileArchiveMatches(file, body)) continue;
      archivedFile = {
        ...file,
        archivedAt: at,
        archivedBy: user.id,
        archivedByName: user.name,
        archiveReason: String(body.reason || "").trim() || "文件归档纠错"
      };
    }
    if (archivedFile) {
      project.files = (project.files || []).map((file) => fileArchiveMatches(file, body) ? archivedFile : file);
    }
  }
  if (!archivedFile) throw new Error("文件记录不存在");
  db.auditLogs.unshift({
    type: "upload",
    target: project.name,
    action: "archive-file",
    user: user.name,
    meta: {
      uploadId: archivedUpload?.id || "",
      fileId: archivedFile.id || "",
      fileName: archivedFile.name || "",
      reason: archivedFile.archiveReason
    },
    at
  });
  return { projectId: project.id, projectName: project.name, uploadId: archivedUpload?.id || "", file: archivedFile };
}

export function updateAlert(db, body, user) {
  const at = new Date().toISOString();
  const update = { ...body, user: user.name, at };
  db.alertUpdates.unshift(update);
  db.auditLogs.unshift({ type: "alert", target: body.project, action: body.action, user: user.name, at });
  return update;
}

export function addComment(db, body, user) {
  const at = new Date().toISOString();
  const comment = { id: body.id || nextCommentId(), ...body, user: user.name, userId: user.id, at };
  db.comments.unshift(comment);
  db.auditLogs.unshift({ type: "comment", target: body.project, user: user.name, at });
  return comment;
}

export function archiveComment(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body.projectId || item.name === body.project || item.name === body.projectName);
  if (!project) throw new Error("项目不存在");
  const commentId = String(body.id || body.commentId || "").trim();
  const at = new Date().toISOString();
  const comments = db.comments || [];
  const comment = comments.find((item) => {
    const sameProject = item.project === project.name || item.projectName === project.name || item.projectId === project.id;
    if (!sameProject || item.archivedAt) return false;
    if (commentId && item.id === commentId) return true;
    return item.body === body.body && item.at === body.at;
  });
  if (!comment) throw new Error("项目动态不存在");
  const isOwner = comment.userId === user.id || comment.user === user.name;
  if (!isOwner && !["shareholder", "admin", "director", "pm"].includes(user.role)) throw new Error("只有记录人或项目管理角色可以归档动态");
  comment.archivedAt = at;
  comment.archivedBy = user.id;
  comment.archivedByName = user.name;
  comment.archiveReason = String(body.reason || "").trim() || "项目动态归档纠错";
  db.auditLogs.unshift({
    type: "comment",
    target: project.name,
    action: "archive",
    user: user.name,
    meta: { commentId: comment.id || "", reason: comment.archiveReason },
    at
  });
  return comment;
}
