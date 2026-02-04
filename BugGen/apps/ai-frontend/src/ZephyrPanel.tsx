import React, { useEffect, useMemo, useRef, useState } from "react";

type ZephyrStatus = "FAIL" | "PASS" | "UNKNOWN" | string;

type Task = {
  key: string;
  summary: string;
  components?: string[];
  sprint?: { name?: string } | null;
  assignee?: unknown;
  parent?: { key?: string } | null;
};

type TestRow = {
  key: string;
  summary: string;
  zephyrStatus?: ZephyrStatus;
  zephyrError?: string;
};

type Step = {
  raw?: any;
  step?: string;
  id?: string | number;
  orderId?: string | number;
};

const API_PREFIX = "/zephyr-api";

function extractIssueKey(input: string) {
  const v = String(input || "").trim();
  if (!v) return null;
  const m = v.match(/\bSE2-\d+\b/i);
  return m ? m[0].toUpperCase() : null;
}

function stepsToPromptText(steps: Step[]) {
  if (!Array.isArray(steps) || steps.length === 0) return "-";
  const lines: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const s: any = steps[i] || {};
    const raw: any = s.raw || {};
    const teststep: any = raw.teststep || {};
    const stepText = teststep.step ?? teststep.description ?? s.step ?? "";
    const cleaned = String(stepText || "").trim();
    if (cleaned) lines.push(`${lines.length + 1}. ${cleaned}`);
  }

  return lines.length ? lines.join("\n") : "-";
}

function buildAiBugPrompt(task: Task | null, test: TestRow | null, steps: Step[]) {
  const stepsApiPath = test?.key ? `${API_PREFIX}/api/test/${String(test.key)}/steps` : "";
  const testId = extractIssueKey(stepsApiPath) ?? "-";
  const testSummary = test?.summary ? String(test.summary) : "-";
  const stepsText = stepsToPromptText(steps);

  const parentKey = task?.parent?.key ? String(task.parent.key) : "-";
  const components = Array.isArray(task?.components) && task?.components?.length ? task.components.join(", ") : "-";
  const sprintName = task?.sprint?.name ? String(task.sprint.name) : task?.sprint ? String(task.sprint) : "-";

  return [
    "Input Data:",
    `- Test Case ID: ${testId}`,
    `- Test Case Summary: ${testSummary}`,
    "- Test Case Steps:",
    `${stepsText}`,
    `- Components: ${components}`,
    `- Parent Key: ${parentKey}`,
    `- Current Sprint: ${sprintName}`
  ].join("\n");
}

async function readJsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed (${res.status})`);
  }
  return data as any;
}

export default function ZephyrPanel() {
  const [input, setInput] = useState("");
  const issueKey = useMemo(() => extractIssueKey(input), [input]);

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "warning" | "success"; text: string } | null>(null);

  const [task, setTask] = useState<Task | null>(null);
  const [tests, setTests] = useState<TestRow[]>([]);

  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const stepsCacheRef = useRef<Map<string, Step[]>>(new Map());

  const [activeTest, setActiveTest] = useState<TestRow | null>(null);
  const [activeTestSteps, setActiveTestSteps] = useState<Step[] | null>(null);
  const [activeTestStepsError, setActiveTestStepsError] = useState<string | null>(null);
  const [activeTestGenerating, setActiveTestGenerating] = useState(false);

  const testDialogRef = useRef<HTMLDialogElement | null>(null);

  const [testDialogPos, setTestDialogPos] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);

  const total = tests.length;
  const safeSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const safePageIndex = Math.min(Math.max(pageIndex, 0), totalPages - 1);
  const start = safePageIndex * safeSize;
  const end = Math.min(total, start + safeSize);
  const pageItems = tests.slice(start, end);

  async function loadTask() {
    setMessage(null);

    const rawInput = input.trim();
    if (!rawInput) {
      setMessage({ type: "error", text: "Please enter an issue key (example: SE2-123) or a JIRA browse URL." });
      return;
    }

    if (!issueKey) {
      setMessage({
        type: "error",
        text: "This is not a correct issue key. Please use the format SE2-<digits> (example: SE2-123) or paste a JIRA browse URL containing it."
      });
      return;
    }

    setIsLoading(true);
    setTask(null);
    setTests([]);
    setPageIndex(0);

    try {
      const res = await fetch(`${API_PREFIX}/api/task/${encodeURIComponent(issueKey)}`);
      const data = await readJsonOrThrow(res);

      setTask(data.task as Task);
      const list = Array.isArray(data.tests) ? (data.tests as TestRow[]) : [];
      setTests(list);

      const linkedCount = Number((data as any)?.meta?.linkedTestsCount ?? 0);
      if (!list.length) {
        if (linkedCount > 0) {
          setMessage({ type: "warning", text: "Linked Tests found, but none are FAIL." });
        } else {
          setMessage({ type: "warning", text: "No linked Tests found." });
        }
      }
    } catch (e: any) {
      setMessage({ type: "error", text: String(e?.message || e) });
    } finally {
      setIsLoading(false);
    }
  }

  async function openTest(test: TestRow) {
    setMessage(null);
    setActiveTest(test);
    setActiveTestSteps(null);
    setActiveTestStepsError(null);

    const dlg = testDialogRef.current;
    dlg?.show();

    if (dlg && !testDialogPos) {
      const r = dlg.getBoundingClientRect();
      setTestDialogPos({ left: r.left, top: r.top });
    }

    try {
      const cached = stepsCacheRef.current.get(test.key);
      if (cached) {
        setActiveTestSteps(cached);
        return;
      }

      const res = await fetch(`${API_PREFIX}/api/test/${encodeURIComponent(test.key)}/steps`);
      const data = await readJsonOrThrow(res);
      const steps = Array.isArray(data.steps) ? (data.steps as Step[]) : [];
      stepsCacheRef.current.set(test.key, steps);
      setActiveTestSteps(steps);
    } catch (e: any) {
      setActiveTestStepsError(String(e?.message || e || "Failed to load steps"));
      setActiveTestSteps([]);
    }
  }

  function closeTestDialog() {
    if (testDialogRef.current?.open) testDialogRef.current.close();
    setActiveTest(null);
    setActiveTestSteps(null);
    setActiveTestStepsError(null);
    setActiveTestGenerating(false);
  }

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const dlg = testDialogRef.current;
      if (!dlg || !dlg.open) return;

      const target = e.target as Node | null;
      if (!target) return;
      if (dlg.contains(target)) return;

      closeTestDialog();
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function beginDragTestDialog(e: React.PointerEvent<HTMLDivElement>) {
    const dlg = testDialogRef.current;
    if (!dlg || !dlg.open) return;

    const rect = dlg.getBoundingClientRect();
    dragRef.current = { pointerId: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onDragTestDialogMove(e: React.PointerEvent<HTMLDivElement>) {
    const dlg = testDialogRef.current;
    const drag = dragRef.current;
    if (!dlg || !dlg.open || !drag || drag.pointerId !== e.pointerId) return;

    const margin = 8;
    const w = dlg.offsetWidth || 0;
    const h = dlg.offsetHeight || 0;
    const maxLeft = Math.max(margin, window.innerWidth - w - margin);
    const maxTop = Math.max(margin, window.innerHeight - h - margin);

    const nextLeft = Math.min(maxLeft, Math.max(margin, Math.round(e.clientX - drag.dx)));
    const nextTop = Math.min(maxTop, Math.max(margin, Math.round(e.clientY - drag.dy)));
    setTestDialogPos({ left: nextLeft, top: nextTop });
  }

  function endDragTestDialog(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
  }

  async function generateBugPrompt() {
    if (!task || !activeTest) {
      setMessage({ type: "error", text: "Please load a task and open a failed test first." });
      return;
    }

    const status = String(activeTest.zephyrStatus || "UNKNOWN").toUpperCase();
    if (status !== "FAIL") return;

    setActiveTestGenerating(true);

    try {
      const cached = stepsCacheRef.current.get(activeTest.key) || [];
      const prompt = buildAiBugPrompt(task, activeTest, cached);
      if (!prompt.trim()) throw new Error("Empty prompt");

      window.postMessage(
        { type: "BUGGENAI_BUG_PROMPT", prompt, meta: { taskKey: task.key, testKey: activeTest.key } },
        "*"
      );
    } catch (e: any) {
      setMessage({ type: "error", text: String(e?.message || e) });
    } finally {
      setActiveTestGenerating(false);
    }
  }

  return (
    <div className="zephyrPanel">
      <div className="zephyrCard">
        <p className="zephyrHelp">
          Enter a JIRA issue key, and the app will automatically retrieve all linked Test issues with <b>Fail</b> status.
        </p>

        <form
          className="zephyrForm"
          onSubmit={(e) => {
            e.preventDefault();
            void loadTask();
          }}
        >
          <input
            className="zephyrInput"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. SE2-123"
            disabled={isLoading}
          />
          <button className="zephyrButton" type="submit" disabled={!issueKey || isLoading}>
            {isLoading ? "Loading..." : "Load"}
          </button>
        </form>

        <div className="zephyrRow">
          <div className={`zephyrTaskPill ${message?.type === "error" ? "error" : message?.type === "warning" ? "warning" : ""}`}>
            <span className="zephyrTaskPillLabel">Task</span>
            <span className="zephyrTaskPillValue">
              {task ? (
                `${task.key} - ${task.summary}`
              ) : isLoading ? (
                <span className="zephyrSkeleton zephyrSkeletonInline" />
              ) : (
                "-"
              )}
            </span>
          </div>
        </div>

        {message && <div className={`zephyrMessage ${message.type}`}>{message.text}</div>}

        {(tests.length > 0 || isLoading) && (
          <>
            <table className="zephyrTable">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Key</th>
                  <th>Summary</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 54 }}></th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`sk-${i}`}>
                        <td>
                          <span className="zephyrSkeleton zephyrSkeletonCell" />
                        </td>
                        <td>
                          <span className="zephyrSkeleton zephyrSkeletonCell" />
                        </td>
                        <td>
                          <span className="zephyrSkeleton zephyrSkeletonCell" />
                        </td>
                        <td>
                          <span className="zephyrSkeleton zephyrSkeletonIcon" />
                        </td>
                      </tr>
                    ))
                  : pageItems.map((t) => {
                      const status = String(t.zephyrStatus || "UNKNOWN");
                      const statusClass = status.toLowerCase();
                      return (
                        <tr key={t.key}>
                          <td>{t.key}</td>
                          <td>{t.summary}</td>
                          <td className={`zephyrStatus ${statusClass}`} title={t.zephyrError || ""}>
                            {status}
                          </td>
                          <td>
                            <button className="zephyrIconButton" type="button" onClick={() => void openTest(t)} title="View details">
                              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                                <path
                                  fill="currentColor"
                                  d="M12 5c-5.5 0-9.6 4.2-10.8 6.4a1.2 1.2 0 0 0 0 1.2C2.4 14.8 6.5 19 12 19s9.6-4.2 10.8-6.4a1.2 1.2 0 0 0 0-1.2C21.6 9.2 17.5 5 12 5Zm0 12c-4.2 0-7.6-3.2-8.7-5 1.1-1.8 4.5-5 8.7-5s7.6 3.2 8.7 5c-1.1 1.8-4.5 5-8.7 5Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
                                />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>

            <div className="zephyrPager">
              <div className="zephyrPagerLeft">
                <span className="zephyrSmall">Showing {start + 1}-{end} of {total}</span>
              </div>
              <div className="zephyrPagerRight">
                <label className="zephyrSmall">Items per page</label>
                <select
                  className="zephyrSelect"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value) || 10);
                    setPageIndex(0);
                  }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={20}>20</option>
                </select>

                <button className="zephyrIconButton" type="button" onClick={() => setPageIndex(0)} disabled={safePageIndex === 0 || total === 0}>
                  <span className="srOnly">First</span>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                    <path fill="currentColor" d="M6 5h2v14H6V5Zm3.5 7 9-7v14l-9-7Z" />
                  </svg>
                </button>
                <button
                  className="zephyrIconButton"
                  type="button"
                  onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                  disabled={safePageIndex === 0 || total === 0}
                >
                  <span className="srOnly">Previous</span>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                    <path fill="currentColor" d="M15.5 5 7 12l8.5 7V5Z" />
                  </svg>
                </button>
                <span className="zephyrSmall">Page {safePageIndex + 1}/{totalPages}</span>
                <button
                  className="zephyrIconButton"
                  type="button"
                  onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePageIndex >= totalPages - 1 || total === 0}
                >
                  <span className="srOnly">Next</span>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                    <path fill="currentColor" d="M8.5 19 17 12 8.5 5v14Z" />
                  </svg>
                </button>
                <button
                  className="zephyrIconButton"
                  type="button"
                  onClick={() => setPageIndex(totalPages - 1)}
                  disabled={safePageIndex >= totalPages - 1 || total === 0}
                >
                  <span className="srOnly">Last</span>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                    <path fill="currentColor" d="M16 5h2v14h-2V5ZM14.5 12 5.5 19V5l9 7Z" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <dialog
        ref={testDialogRef}
        className="zephyrDialog"
        style={
          testDialogPos
            ? { left: testDialogPos.left, top: testDialogPos.top, transform: "none" }
            : undefined
        }
        onCancel={(e) => {
          e.preventDefault();
          closeTestDialog();
        }}
        onClick={(e) => {
          if (e.target === testDialogRef.current) closeTestDialog();
        }}
      >
        <div
          className="zephyrDialogHeader"
          onPointerDown={beginDragTestDialog}
          onPointerMove={onDragTestDialogMove}
          onPointerUp={endDragTestDialog}
          onPointerCancel={endDragTestDialog}
        >
          <div>
            <div className="zephyrDialogTitle">Test Details</div>
            <div className="zephyrSmall">{task ? `Task: ${task.key}` : ""}</div>
          </div>
          <button className="zephyrIconButton" type="button" onClick={closeTestDialog}>
            Close
          </button>
        </div>
        <div className="zephyrDialogBody">
          <div>
            <div className="zephyrFieldLabel">Key</div>
            <div className="zephyrSelectedList">{activeTest?.key || "-"}</div>
          </div>
          <div>
            <div className="zephyrFieldLabel">Summary</div>
            <div className="zephyrSelectedList">{activeTest?.summary || "-"}</div>
          </div>
          <div>
            <div className="zephyrFieldLabel">Zephyr status</div>
            <div className={`zephyrSelectedList zephyrStatus ${(activeTest?.zephyrStatus || "UNKNOWN").toString().toLowerCase()}`}>
              {String(activeTest?.zephyrStatus || "UNKNOWN")}
            </div>
          </div>
          <div>
            <div className="zephyrFieldLabel">Steps</div>
            <div className="zephyrSelectedList zephyrStepsWrap">
              {activeTestSteps === null ? (
                <div className="zephyrSkeletonStack">
                  <div className="zephyrSkeleton zephyrSkeletonLine" />
                  <div className="zephyrSkeleton zephyrSkeletonLine" />
                  <div className="zephyrSkeleton zephyrSkeletonLine" />
                </div>
              ) : activeTestSteps.length === 0 ? (
                <div className="zephyrSmall">No steps found.</div>
              ) : (
                <table className="zephyrStepsTable">
                  <thead>
                    <tr>
                      <th style={{ width: 72 }}>#</th>
                      <th>Step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTestSteps.map((s: any, i: number) => {
                      const raw = s?.raw || {};
                      const teststep = raw?.teststep || {};
                      const orderId = teststep.orderId ?? raw.orderId ?? s.orderId ?? s.id ?? i + 1;
                      const stepText = teststep.step ?? teststep.description ?? s.step ?? "";
                      return (
                        <tr key={String(orderId)}>
                          <td className="zephyrStepsCell">{String(orderId)}</td>
                          <td className="zephyrStepsCell">{String(stepText)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {activeTestStepsError && (
            <div>
              <div className="zephyrFieldLabel">Steps error</div>
              <textarea className="zephyrTextarea" readOnly value={activeTestStepsError} />
            </div>
          )}

          {activeTest?.zephyrError && (
            <div>
              <div className="zephyrFieldLabel">Zephyr error</div>
              <textarea className="zephyrTextarea" readOnly value={String(activeTest.zephyrError)} />
            </div>
          )}
        </div>
        <div className="zephyrDialogFooter">
          {String(activeTest?.zephyrStatus || "UNKNOWN").toUpperCase() === "FAIL" && (
            <>
              <button
                className="zephyrButton"
                type="button"
                onClick={() => void generateBugPrompt()}
                disabled={!activeTest || activeTestGenerating || activeTestSteps === null || (activeTestSteps?.length ?? 0) === 0}
              >
                {activeTestGenerating ? "Generating..." : "Generate Bug"}
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
