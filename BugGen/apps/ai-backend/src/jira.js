import axios from "axios";
import FormData from "form-data";
import { env } from "./config.js";

function jiraClient() {
  const token = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
  return axios.create({
    baseURL: env.JIRA_BASE_URL,
    headers: {
      Authorization: `Basic ${token}`,
      Accept: "application/json"
    },
    timeout: 30000
  });
}

let cachedBugCreateFields = null;
let cachedBugCreateFieldsAt = 0;

async function getBugCreateFields() {
  const now = Date.now();
  if (cachedBugCreateFields && now - cachedBugCreateFieldsAt < 10 * 60 * 1000) {
    return cachedBugCreateFields;
  }

  const api = jiraClient();

  try {
    const res = await api.get("/rest/api/3/issue/createmeta", {
      params: {
        projectKeys: env.JIRA_PROJECT_KEY,
        issuetypeNames: "Bug",
        expand: "projects.issuetypes.fields"
      }
    });

    const fields =
      res?.data?.projects?.[0]?.issuetypes?.[0]?.fields ||
      res?.data?.projects?.[0]?.issuetypes?.find((t) => String(t?.name || "").toLowerCase() === "bug")?.fields ||
      null;

    cachedBugCreateFields = fields;
    cachedBugCreateFieldsAt = now;
    return fields;
  } catch (e) {
    console.error("Failed to fetch Jira create meta fields:", e?.message);
    return null;
  }
}

export async function getBugReproducibilityField() {
  const fields = await getBugCreateFields();
  if (!fields) return null;

  const normalize = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
  const target = normalize("Reproducibility");

  const entry = Object.entries(fields).find(([, f]) => normalize(f?.name) === target);
  if (!entry) return null;

  const [fieldId, field] = entry;
  const allowed = Array.isArray(field?.allowedValues) ? field.allowedValues : [];

  const options = allowed
    .map((v) => ({
      id: v?.id ? String(v.id) : "",
      value: v?.value ? String(v.value) : "",
      name: v?.name ? String(v.name) : (v?.value ? String(v.value) : "")
    }))
    .filter((o) => {
      if (!o?.name) return false;
      const n = String(o.name).trim();
      if (!n) return false;
      const lower = n.toLowerCase();
      if (lower === "-- select --" || lower === "--select--") return false;
      if (lower.startsWith("--") && lower.includes("select")) return false;
      return true;
    });

  return {
    fieldId: String(fieldId),
    options
  };
}

export async function getPriorities() {
  const api = jiraClient();

  try {
    const res = await api.get("/rest/api/3/priority");
    const priorities = Array.isArray(res.data) ? res.data : [];
    return priorities
      .filter((p) => p && p.name)
      .map((p) => ({ id: String(p.id || ""), name: String(p.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.error("Failed to fetch priorities:", e?.message);
    return [];
  }
}

export async function getIssueByKey(key) {
  const api = jiraClient();
  const issueKey = String(key || "").trim();
  if (!issueKey) return null;

  try {
    const res = await api.get(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
      params: { fields: "summary,key" }
    });
    const k = res?.data?.key;
    const summary = res?.data?.fields?.summary;
    if (!k) return null;
    return { key: String(k), summary: String(summary || "") };
  } catch (e) {
    return null;
  }
}

function toAdfDoc(text) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: String(text || "") }]
      }
    ]
  };
}

export async function createJiraBug({ report }) {
  const api = jiraClient();

  const lines = [];
  if (Array.isArray(report.stepsToReproduce) && report.stepsToReproduce.length) {
    lines.push("Steps to Reproduce:");
    report.stepsToReproduce.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }
  if (report.expectedResult) {
    lines.push(`Expected Result: ${report.expectedResult}`);
    lines.push("");
  }
  if (report.actualResult) {
    lines.push(`Actual Result: ${report.actualResult}`);
    lines.push("");
  }
  if (report.environment) {
    lines.push(`Environment: ${report.environment}`);
    lines.push("");
  }
  if (report.severity) {
    lines.push(`Severity: ${report.severity}`);
  }
  if (report.priority) {
    lines.push(`Priority: ${report.priority}`);
  }
  if (report.component) {
    lines.push(`Component: ${report.component}`);
  }

  const payload = {
    fields: {
      project: { key: env.JIRA_PROJECT_KEY },
      summary: report.title,
      description: toAdfDoc(lines.join("\n").trim()),
      issuetype: { name: "Bug" }
    }
  };

  const res = await api.post("/rest/api/3/issue", payload, {
    headers: { "Content-Type": "application/json" }
  });

  return {
    id: res.data.id,
    key: res.data.key,
    self: res.data.self,
    url: `${env.JIRA_BASE_URL.replace(/\/$/, "")}/browse/${res.data.key}`
  };
}

export async function attachFileToIssue({ issueKey, buffer, filename, contentType }) {
  const api = jiraClient();

  const form = new FormData();
  form.append("file", buffer, {
    filename: filename || "screenshot",
    contentType: contentType || "application/octet-stream"
  });

  const res = await api.post(`/rest/api/3/issue/${issueKey}/attachments`, form, {
    headers: {
      ...form.getHeaders(),
      "X-Atlassian-Token": "no-check"
    },
    maxBodyLength: Infinity
  });

  return res.data;
}

export async function linkIssueToParent({ issueKey, parentKey, linkTypeName }) {
  const api = jiraClient();

  const payload = {
    type: { name: linkTypeName || env.JIRA_LINK_TYPE },
    inwardIssue: { key: parentKey },
    outwardIssue: { key: issueKey }
  };

  const res = await api.post("/rest/api/3/issueLink", payload, {
    headers: { "Content-Type": "application/json" }
  });

  return res.data;
}

export async function getProjectComponents(query = "") {
  const api = jiraClient();
  
  try {
    const res = await api.get(`/rest/api/3/project/${env.JIRA_PROJECT_KEY}/components`);
    const allComponents = res.data.map((c) => ({ id: c.id, name: c.name }));
    
    if (query && query.length > 0) {
      const lowerQuery = query.toLowerCase();
      return allComponents.filter(c => c.name.toLowerCase().includes(lowerQuery));
    }
    
    return allComponents;
  } catch (e) {
    console.error("Failed to fetch components:", e?.message);
    return [];
  }
}

export async function getAssignableUsers(query = "") {
  const api = jiraClient();
  
  if (query && query.length > 0) {
    try {
      const res = await api.get("/rest/api/3/user/assignable/search", {
        params: {
          project: env.JIRA_PROJECT_KEY,
          query,
          maxResults: 50
        }
      });

      return (res.data || []).map((u) => ({
        accountId: u.accountId,
        displayName: u.displayName,
        emailAddress: u.emailAddress || "",
        avatarUrl: u.avatarUrls?.["24x24"] || ""
      }));
    } catch (e) {
      console.error("Failed to search users:", e?.message);
      // Fallback: return empty list and let the UI continue to show the default list.
      return [];
    }
  }
  
  try {
    const res = await api.get("/rest/api/3/user/assignable/search", {
      params: {
        project: env.JIRA_PROJECT_KEY,
        maxResults: 50
      }
    });
    return res.data.map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      emailAddress: u.emailAddress || "",
      avatarUrl: u.avatarUrls?.["24x24"] || ""
    }));
  } catch (e) {
    console.error("Failed to fetch assignable users:", e?.message);
    return [];
  }
}

export async function getSprints(query = "") {
  const api = jiraClient();
  
  if (query && query.length > 0) {
    try {
      const res = await api.get("/rest/api/latest/jql/autocompletedata/suggestions", {
        params: {
          fieldName: "cf[10007]",
          fieldValue: query
        }
      });
      return (res.data.results || []).map((s) => {
        const rawName = s.displayName || s.value || "";
        const cleanName = rawName.replace(/<[^>]*>/g, "");
        return {
          id: s.value || "",
          name: cleanName,
          state: ""
        };
      });
    } catch (e) {
      console.error("Failed to search sprints:", e?.message);
      return [];
    }
  }
  
  try {
    const boardsRes = await api.get("/rest/agile/1.0/board", {
      params: {
        projectKeyOrId: env.JIRA_PROJECT_KEY,
        maxResults: 10
      }
    });
    
    const boards = boardsRes.data.values || [];
    if (boards.length === 0) return [];
    
    const boardId = boards[0].id;
    const sprintsRes = await api.get(`/rest/agile/1.0/board/${boardId}/sprint`, {
      params: {
        state: "active,future",
        maxResults: 20
      }
    });
    
    const sprints = (sprintsRes.data.values || []).map((s) => ({
      id: String(s.id),
      name: s.name,
      state: s.state
    }));
    
    // Sort: active sprints first, then future sprints
    sprints.sort((a, b) => {
      if (a.state === "active" && b.state !== "active") return -1;
      if (a.state !== "active" && b.state === "active") return 1;
      return 0;
    });
    
    return sprints;
  } catch (e) {
    console.error("Failed to fetch sprints:", e?.message);
    return [];
  }
}

export async function searchIssues(query = "") {
  const api = jiraClient();
  
  if (query && query.length > 0) {
    const res = await api.get("/rest/api/latest/jql/autocompletedata/suggestions", {
      params: {
        fieldName: "parent",
        fieldValue: query
      }
    });
    return (res.data.results || []).map((i) => {
      const rawName = i.displayName || i.value || "";
      const cleanName = rawName.replace(/<[^>]*>/g, "");
      return {
        key: i.value || "",
        summary: cleanName
      };
    });
  }
  
  try {
    const jql = `project = ${env.JIRA_PROJECT_KEY} ORDER BY updated DESC`;
    const res = await api.get("/rest/api/3/search", {
      params: {
        jql,
        maxResults: 50,
        fields: "summary,key"
      }
    });
    return res.data.issues.map((i) => ({ key: i.key, summary: i.fields.summary }));
  } catch (e) {
    return [];
  }
}

export async function createJiraBugWithOptions({ report, componentIds, parentKey, relatedToKeys, assigneeId, sprintId, jiraPriority, jiraReproducibility, comment }) {
  const api = jiraClient();

  const cleanText = (v) => {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  };

  const cleanSteps = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr.map((s) => cleanText(s)).filter((s) => s.length > 0);
  };

  const adfContent = [];
  
  const description = cleanText(report?.description);
  const steps = cleanSteps(report?.stepsToReproduce);
  const expectedResult = cleanText(report?.expectedResult);
  const actualResult = cleanText(report?.actualResult);
  const environment = cleanText(report?.environment);
  const reproducibility = cleanText(report?.reproducibility);
  const impact = cleanText(report?.impact);
  const workaround = cleanText(report?.workaround);

  if (description) {
    adfContent.push({
      type: "paragraph",
      content: [{ type: "text", text: "Description:", marks: [{ type: "strong" }] }]
    });
    adfContent.push({
      type: "paragraph",
      content: [{ type: "text", text: description }]
    });
  }
  
  if (steps.length) {
    adfContent.push({
      type: "paragraph",
      content: [{ type: "text", text: "Steps to Reproduce:", marks: [{ type: "strong" }] }]
    });
    adfContent.push({
      type: "orderedList",
      content: steps.map(step => ({
        type: "listItem",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: step }]
        }]
      }))
    });
  }
  
  if (expectedResult) {
    adfContent.push({
      type: "paragraph",
      content: [
        { type: "text", text: "Expected Result: ", marks: [{ type: "strong" }] },
        { type: "text", text: expectedResult }
      ]
    });
  }
  
  if (actualResult) {
    adfContent.push({
      type: "paragraph",
      content: [
        { type: "text", text: "Actual Result: ", marks: [{ type: "strong" }] },
        { type: "text", text: actualResult }
      ]
    });
  }
  
  if (environment) {
    adfContent.push({
      type: "paragraph",
      content: [
        { type: "text", text: "Environment: ", marks: [{ type: "strong" }] },
        { type: "text", text: environment }
      ]
    });
  }
  
  if (reproducibility) {
    adfContent.push({
      type: "paragraph",
      content: [
        { type: "text", text: "Reproducibility: ", marks: [{ type: "strong" }] },
        { type: "text", text: reproducibility }
      ]
    });
  }
  
  if (impact) {
    adfContent.push({
      type: "paragraph",
      content: [
        { type: "text", text: "Impact: ", marks: [{ type: "strong" }] },
        { type: "text", text: impact }
      ]
    });
  }
  
  if (workaround) {
    adfContent.push({
      type: "paragraph",
      content: [
        { type: "text", text: "Workaround: ", marks: [{ type: "strong" }] },
        { type: "text", text: workaround }
      ]
    });
  }

  const payload = {
    fields: {
      project: { key: env.JIRA_PROJECT_KEY },
      summary: report.title,
      description: {
        type: "doc",
        version: 1,
        content: adfContent.length > 0 ? adfContent : [{ type: "paragraph", content: [{ type: "text", text: "No description provided." }] }]
      },
      issuetype: { name: "Bug" }
    }
  };

  if (componentIds && componentIds.length > 0) {
    payload.fields.components = componentIds.map(id => ({ id: String(id) }));
  }

  if (assigneeId) {
    payload.fields.assignee = { accountId: assigneeId };
  }

  if (jiraPriority) {
    payload.fields.priority = { name: jiraPriority };
  }

  if (jiraReproducibility?.fieldId && jiraReproducibility?.option) {
    const fieldId = String(jiraReproducibility.fieldId);
    const opt = jiraReproducibility.option;

    if (opt?.id) {
      payload.fields[fieldId] = { id: String(opt.id) };
    } else if (opt?.value) {
      payload.fields[fieldId] = { value: String(opt.value) };
    } else if (opt?.name) {
      payload.fields[fieldId] = { value: String(opt.name) };
    }
  }

  console.log("Creating JIRA Bug with payload:", JSON.stringify(payload, null, 2));
  
  let res;
  try {
    res = await api.post("/rest/api/3/issue", payload, {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("Jira API error - Full response:", JSON.stringify(e?.response?.data, null, 2));
    console.error("Jira API error - Status:", e?.response?.status);
    console.error("Jira API error - Message:", e?.message);
    const errorData = e?.response?.data;
    let errorMsg = e?.message || "Unknown error";
    if (errorData) {
      if (errorData.errorMessages && errorData.errorMessages.length > 0) {
        errorMsg = errorData.errorMessages.join(", ");
      } else if (errorData.errors && Object.keys(errorData.errors).length > 0) {
        errorMsg = Object.entries(errorData.errors).map(([k, v]) => `${k}: ${v}`).join(", ");
      } else {
        errorMsg = JSON.stringify(errorData);
      }
    }
    throw new Error(errorMsg);
  }

  const issue = {
    id: res.data.id,
    key: res.data.key,
    self: res.data.self,
    url: `${env.JIRA_BASE_URL.replace(/\/$/, "")}/browse/${res.data.key}`
  };

  if (sprintId) {
    try {
      await api.post(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
        issues: [issue.key]
      });
    } catch (e) {
      console.error("Failed to add to sprint:", e?.message);
    }
  }

  if (parentKey) {
    try {
      await api.put(`/rest/api/3/issue/${issue.key}`, {
        fields: {
          parent: { key: parentKey }
        }
      }, {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      console.error("Failed to set parent:", e?.response?.data || e?.message);
    }
  }

  const relatedKeys = Array.isArray(relatedToKeys)
    ? relatedToKeys.map((k) => String(k || "").trim()).filter(Boolean)
    : [];

  if (relatedKeys.length > 0) {
    for (const k of relatedKeys) {
      try {
        await linkIssueToParent({ issueKey: issue.key, parentKey: k });
      } catch (e) {
        console.error("Failed to link related issue:", e?.message);
      }
    }
  }

  const safeComment = cleanText(comment);
  if (safeComment) {
    try {
      await api.post(`/rest/api/3/issue/${issue.key}/comment`, {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: safeComment }]
            }
          ]
        }
      }, {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      console.error("Failed to add comment:", e?.response?.data || e?.message);
    }
  }

  return issue;
}
