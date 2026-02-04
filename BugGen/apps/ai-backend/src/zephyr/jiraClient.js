export class JiraClient {
  constructor(cfg) {
    this.baseUrl = String(cfg.baseUrl || "").replace(/\/$/, "");
    const token = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64");
    this.authHeader = `Basic ${token}`;
    this.sprintFieldId = cfg.sprintFieldId;
  }

  parseSprintName(raw) {
    if (!raw) return undefined;

    if (Array.isArray(raw) && raw.length) {
      const first = raw[0];
      if (typeof first === "string") {
        const m = first.match(/\bname=([^,]+)\b/);
        return m ? m[1] : undefined;
      }
      if (first && typeof first === "object" && typeof first.name === "string") {
        return first.name;
      }
    }

    if (typeof raw === "string") {
      const m = raw.match(/\bname=([^,]+)\b/);
      return m ? m[1] : undefined;
    }

    if (typeof raw === "object" && raw && typeof raw.name === "string") {
      return raw.name;
    }

    return undefined;
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Jira API ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
    }

    return await res.json();
  }

  async getIssue(issueKey) {
    const sprintField = this.sprintFieldId ? `,${this.sprintFieldId}` : "";
    const data = await this.request(
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,issuetype,project,components,assignee,parent${sprintField}`
    );

    const sprintName = this.sprintFieldId ? this.parseSprintName(data.fields?.[this.sprintFieldId]) : undefined;

    return {
      id: String(data.id ?? ""),
      key: data.key,
      summary: data.fields?.summary ?? "",
      issueTypeName: data.fields?.issuetype?.name ?? "",
      projectId: String(data.fields?.project?.id ?? ""),
      components: Array.isArray(data.fields?.components)
        ? data.fields.components.map((c) => c?.name).filter(Boolean)
        : [],
      assignee: data.fields?.assignee
        ? { displayName: data.fields.assignee?.displayName, accountId: data.fields.assignee?.accountId }
        : null,
      parent: data.fields?.parent
        ? { key: data.fields.parent?.key, summary: data.fields.parent?.fields?.summary }
        : null,
      sprint: sprintName ? { name: sprintName } : null
    };
  }

  async getLinkedIssuesByType(issueKey, issueTypeName) {
    const data = await this.request("GET", `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=issuelinks,summary`);

    const links = data.fields?.issuelinks ?? [];

    const linkedKeys = links
      .flatMap((l) => [l.inwardIssue?.key, l.outwardIssue?.key])
      .filter(Boolean);

    const uniqueKeys = [...new Set(linkedKeys)];

    const linkedIssues = await Promise.all(uniqueKeys.map((k) => this.getIssue(k)));

    return linkedIssues.filter((i) => String(i.issueTypeName || "").toLowerCase() === String(issueTypeName || "").toLowerCase());
  }

  async createBug(input) {
    const payload = {
      fields: {
        project: { key: input.projectKey },
        issuetype: { name: input.issueTypeName },
        summary: input.summary,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: input.description }]
            }
          ]
        }
      }
    };

    if (input.priorityName) {
      payload.fields.priority = { name: input.priorityName };
    }

    const res = await this.request("POST", `/rest/api/3/issue`, payload);
    return res.key;
  }

  async linkIssues(inwardKey, outwardKey, linkType) {
    await this.request("POST", `/rest/api/3/issueLink`, {
      type: { name: linkType },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey }
    });
  }
}
