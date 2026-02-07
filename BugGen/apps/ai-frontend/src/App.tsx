import React, { useEffect, useMemo, useRef, useState } from "react";

import { COMPONENT_ASSIGNEES_BY_COMPONENT, COMPONENT_ASSIGNEES_BY_ASSIGNEE } from "./generated/componentAssignees";

import ReactMarkdown from "react-markdown";

import remarkGfm from "remark-gfm";

import ZephyrPanel from "./ZephyrPanel";



const API_BASE_URL = "/ai-api";

const ZEPHYR_APP_URL = import.meta.env.VITE_ZEPHYR_APP_URL || "http://localhost:3006";



type TabKey = "zephyr" | "ai";



type BugReport = {

  title: string;

  description?: string;

  stepsToReproduce: string[];

  expectedResult: string;

  actualResult: string;

  component: string;

  environment: string;

  reproducibility?: string;

  workaround?: string | null;

  impact?: string;

  jiraPriority?: string;

};



type JiraComponent = { id: string; name: string };

type JiraIssue = { key: string; summary: string };

type JiraUser = { accountId: string; displayName: string; emailAddress: string; avatarUrl: string };

type JiraSprint = { id: string; name: string; state: string };

type JiraPriority = { id: string; name: string };



type PromptJiraHints = {

  components: string[];

  parentKey: string;

  sprintName: string;

  priorityName?: string;

  testCaseId: string;

};



export default function App() {

  const [activeTab, setActiveTab] = useState<TabKey>("zephyr");



  const [input, setInput] = useState("");

  const DEFAULT_INPUT_HEIGHT = 60;

  const [inputHeight, setInputHeight] = useState<number>(DEFAULT_INPUT_HEIGHT);

  const [files, setFiles] = useState<File[]>([]);

  const [imagePreviews, setImagePreviews] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string } | null>(null);

  const [report, setReport] = useState<BugReport | null>(null);

  const [submittedImagePreviews, setSubmittedImagePreviews] = useState<string[]>([]);

  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);

  const [submittedFiles, setSubmittedFiles] = useState<File[]>([]);

  const [conversationHistory, setConversationHistory] = useState<{role: string; content: string}[]>([]);

  const [chatMessages, setChatMessages] = useState<{role: string; content: string; report?: BugReport}[]>([]);

  const [streamingText, setStreamingText] = useState("");



  const [jiraComponents, setJiraComponents] = useState<JiraComponent[]>([]);

  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);

  const [jiraUsers, setJiraUsers] = useState<JiraUser[]>([]);

  const [jiraSprints, setJiraSprints] = useState<JiraSprint[]>([]);

  const [jiraPriorities, setJiraPriorities] = useState<JiraPriority[]>([]);

  const [selectedComponents, setSelectedComponents] = useState<{id: string; name: string}[]>([]);

  const [selectedParent, setSelectedParent] = useState("");

  const [selectedRelatedToKeys, setSelectedRelatedToKeys] = useState<string[]>([]);

  const [selectedAssignee, setSelectedAssignee] = useState("");

  const [selectedSprint, setSelectedSprint] = useState("");

  const [selectedJiraPriority, setSelectedJiraPriority] = useState("");

  const [jiraComment, setJiraComment] = useState("");

  const [jiraLoading, setJiraLoading] = useState(false);

  const [jiraResult, setJiraResult] = useState<{ url: string; key: string } | null>(null);



  const [deletedReportFields, setDeletedReportFields] = useState<Record<string, boolean>>({});



  const [promptJiraHints, setPromptJiraHints] = useState<PromptJiraHints>({

    components: [],

    parentKey: "",

    sprintName: "",

    testCaseId: ""

  });



  const [componentSearch, setComponentSearch] = useState("");

  const [assigneeSearch, setAssigneeSearch] = useState("");

  const [selectedAssigneeLabel, setSelectedAssigneeLabel] = useState("");

  const [isAssigneeEditing, setIsAssigneeEditing] = useState(false);

  const [parentSearch, setParentSearch] = useState("");

  const [relatedToSearch, setRelatedToSearch] = useState("");

  const [sprintSearch, setSprintSearch] = useState("");

  const [showComponentList, setShowComponentList] = useState(false);

  const [showAssigneeList, setShowAssigneeList] = useState(false);

  const [showParentList, setShowParentList] = useState(false);

  const [showRelatedToList, setShowRelatedToList] = useState(false);

  const [showSprintList, setShowSprintList] = useState(false);

  const [relatedToIssues, setRelatedToIssues] = useState<JiraIssue[]>([]);



  const jiraMissingFields = useMemo(() => {

    if (!report) return [] as string[];

    const missing: string[] = [];

    if (!String(report.title || "").trim()) missing.push("Title");

    if (selectedComponents.length === 0) missing.push("Component");

    if (!selectedAssignee) missing.push("Assignee");

    return missing;

  }, [report, selectedComponents, selectedAssignee, selectedJiraPriority]);



  const jiraCreateTooltip = useMemo(() => {

    if (jiraMissingFields.length === 0) return "";

    return `Please fill the mandatory fields before creating the Jira bug: ${jiraMissingFields.join(", ")}.`;

  }, [jiraMissingFields]);



  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const inputTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const headerRef = useRef<HTMLDivElement | null>(null);

  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);

  const reportTopRef = useRef<HTMLDivElement | null>(null);

  const suppressAutoScrollRef = useRef(false);

  const streamingTextRef = useRef<HTMLDivElement | null>(null);

  const streamingAutoScrollRef = useRef(true);

  const mainAreaRef = useRef<HTMLDivElement | null>(null);

  const mainAreaAutoScrollRef = useRef(true);

  const editableReportRef = useRef<HTMLDivElement | null>(null);

  const editableTitleRef = useRef<HTMLInputElement | null>(null);

  const lastRoutingUserSearchRef = useRef<string | null>(null);

  const lastRoutingSprintSearchRef = useRef<string | null>(null);

  const componentsManualOverrideRef = useRef(false);

  const relatedToManualOverrideRef = useRef(false);

  const assigneeManualOverrideRef = useRef(false);

  const lastIssueResolvePrefetchRef = useRef<string>("");

  const lastSprintResolvePrefetchRef = useRef<string>("");

  const assigneePrevRef = useRef<{ id: string; label: string } | null>(null);

  const assigneeWrapRef = useRef<HTMLDivElement | null>(null);

  const jiraSectionRef = useRef<HTMLDivElement | null>(null);



  const [headerHeight, setHeaderHeight] = useState(0);



  useEffect(() => {

    const el = headerRef.current;

    if (!el) return;



    const update = () => setHeaderHeight(Math.round(el.getBoundingClientRect().height));

    update();



    const ro = new ResizeObserver(() => update());

    ro.observe(el);

    window.addEventListener("resize", update);

    return () => {

      ro.disconnect();

      window.removeEventListener("resize", update);

    };

  }, []);



  function AutoResizeEditTextarea({ value, onChange, rows }: { value: string; onChange: (v: string) => void; rows?: number }) {

    const ref = useRef<HTMLTextAreaElement | null>(null);

    const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

    const DEFAULT_HEIGHT = 60;

    const MAX_HEIGHT = 420;



    useEffect(() => {

      const el = ref.current;

      if (!el) return;



      el.style.height = "auto";

      if (!String(value || "").trim()) {

        el.style.height = `${DEFAULT_HEIGHT}px`;

        return;

      }



      const next = Math.min(MAX_HEIGHT, Math.max(DEFAULT_HEIGHT, el.scrollHeight));

      el.style.height = `${next}px`;

    }, [value]);



    function beginResize(e: React.PointerEvent<HTMLDivElement>) {

      const el = ref.current;

      if (!el) return;



      e.preventDefault();

      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

      const rect = el.getBoundingClientRect();

      dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startHeight: rect.height };

    }



    function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {

      const el = ref.current;

      const drag = dragRef.current;

      if (!el || !drag || drag.pointerId !== e.pointerId) return;



      const dy = e.clientY - drag.startY;

      const next = Math.min(MAX_HEIGHT, Math.max(DEFAULT_HEIGHT, Math.round(drag.startHeight + dy)));

      el.style.height = `${next}px`;

    }



    function endResize(e: React.PointerEvent<HTMLDivElement>) {

      const drag = dragRef.current;

      if (!drag || drag.pointerId !== e.pointerId) return;

      dragRef.current = null;

    }



    return (

      <div className="editTextareaWrap">

        <textarea

          className="editTextarea"

          ref={ref}

          value={value}

          onChange={(e) => onChange(e.target.value)}

          rows={rows}

        />

        <div

          className="editTextareaResizeHandle"

          onPointerDown={beginResize}

          onPointerMove={onResizeMove}

          onPointerUp={endResize}

          onPointerCancel={endResize}

        />

      </div>

    );

  }



  function AutoResizeCommentTextarea({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {

    const ref = useRef<HTMLTextAreaElement | null>(null);

    const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

    const DEFAULT_HEIGHT = 96;

    const MAX_HEIGHT = 420;



    useEffect(() => {

      const el = ref.current;

      if (!el) return;



      el.style.height = "auto";

      if (!String(value || "").trim()) {

        el.style.height = `${DEFAULT_HEIGHT}px`;

        return;

      }



      const next = Math.min(MAX_HEIGHT, Math.max(DEFAULT_HEIGHT, el.scrollHeight));

      el.style.height = `${next}px`;

    }, [value]);



    function beginResize(e: React.PointerEvent<HTMLDivElement>) {

      const el = ref.current;

      if (!el) return;



      e.preventDefault();

      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

      const rect = el.getBoundingClientRect();

      dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startHeight: rect.height };

    }



    function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {

      const el = ref.current;

      const drag = dragRef.current;

      if (!el || !drag || drag.pointerId !== e.pointerId) return;



      const dy = e.clientY - drag.startY;

      const next = Math.min(MAX_HEIGHT, Math.max(DEFAULT_HEIGHT, Math.round(drag.startHeight + dy)));

      el.style.height = `${next}px`;

    }



    function endResize(e: React.PointerEvent<HTMLDivElement>) {

      const drag = dragRef.current;

      if (!drag || drag.pointerId !== e.pointerId) return;

      dragRef.current = null;

    }



    return (

      <div className="editTextareaWrap">

        <textarea

          className="commentInput"

          ref={ref}

          placeholder="Optional comment..."

          value={value}

          onChange={(e) => onChange(e.target.value)}

          disabled={disabled}

          rows={2}

        />

        {!disabled && (

          <div

            className="editTextareaResizeHandle"

            onPointerDown={beginResize}

            onPointerMove={onResizeMove}

            onPointerUp={endResize}

            onPointerCancel={endResize}

          />

        )}

      </div>

    );

  }



  function showErrorToast(message: string) {

    setToast({ message });

  }



  function startTextareaResize(e: React.PointerEvent<HTMLDivElement>) {

    if (isLoading) return;

    const el = inputTextareaRef.current;

    if (!el) return;



    e.preventDefault();

    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);



    const startY = e.clientY;

    const startHeight = el.getBoundingClientRect().height;



    function onMove(ev: PointerEvent) {

      const dy = ev.clientY - startY;

      const next = Math.max(60, Math.min(260, Math.round(startHeight - dy)));

      setInputHeight(next);

    }



    function onUp() {

      window.removeEventListener("pointermove", onMove);

      window.removeEventListener("pointerup", onUp);

    }



    window.addEventListener("pointermove", onMove);

    window.addEventListener("pointerup", onUp);

  }



  function scrollToBottom() {

    if (!mainAreaAutoScrollRef.current) return;

    requestAnimationFrame(() => {

      bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });

    });

  }



  function handleMainAreaScroll(e: React.UIEvent<HTMLDivElement>) {

    const el = e.currentTarget;

    const threshold = 50;

    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;

    mainAreaAutoScrollRef.current = atBottom;

  }



  useEffect(() => {

    fetchJiraData();

  }, []);



  useEffect(() => {

    const el = inputTextareaRef.current;

    if (!el) return;



    if (!input.trim()) {

      setInputHeight(DEFAULT_INPUT_HEIGHT);

      return;

    }



    const needed = el.scrollHeight;

    setInputHeight((prev) => {

      const next = Math.max(prev, needed);

      const clamped = Math.max(60, Math.min(260, next));

      return clamped === prev ? prev : clamped;

    });

  }, [input]);



  useEffect(() => {

    function onMessage(event: MessageEvent) {

      const data: any = event?.data;

      if (!data || data.type !== "BUGGENAI_BUG_PROMPT") return;



      const prompt = typeof data.prompt === "string" ? data.prompt : "";

      if (!prompt.trim()) return;



      setPromptJiraHints(parsePromptJiraHints(prompt));



      setActiveTab("ai");

      setInput(prompt);



      window.setTimeout(() => {

        const el = inputTextareaRef.current;

        if (!el) return;

        el.scrollIntoView({ behavior: "smooth", block: "center" });

        if (!el.disabled) el.focus();

      }, 0);

    }



    window.addEventListener("message", onMessage);

    return () => window.removeEventListener("message", onMessage);

  }, []);



  useEffect(() => {

    if (suppressAutoScrollRef.current) {

      suppressAutoScrollRef.current = false;

      return;

    }



    if (chatMessages.length > 0 || isLoading) {

      scrollToBottom();

    }

  }, [chatMessages.length, isLoading, streamingText]);



  useEffect(() => {

    if (activeTab !== "ai") return;

    if (!isLoading) return;

    if (!mainAreaAutoScrollRef.current) return;

    requestAnimationFrame(() => {

      bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });

    });

  }, [activeTab, isLoading]);



  useEffect(() => {

    if (activeTab !== "ai") return;

    requestAnimationFrame(() => {

      const el = inputTextareaRef.current;

      if (!el) return;



      if (!input.trim()) {

        setInputHeight(DEFAULT_INPUT_HEIGHT);

        return;

      }



      const needed = el.scrollHeight;

      const clamped = Math.max(DEFAULT_INPUT_HEIGHT, Math.min(260, needed));

      setInputHeight(clamped);

    });

  }, [activeTab]);



  useEffect(() => {

    if (!isLoading) {

      streamingAutoScrollRef.current = true;

      mainAreaAutoScrollRef.current = true;

      return;

    }



    const el = streamingTextRef.current;

    if (!el) return;

    if (!streamingAutoScrollRef.current) return;



    el.scrollTop = el.scrollHeight;

  }, [streamingText, isLoading]);



  useEffect(() => {

    (window as any).__BUGGENAI_AI_STREAM_INFLIGHT = Boolean(isLoading);

    window.dispatchEvent(

      new CustomEvent("BUGGENAI_AI_STREAM_STATUS", {

        detail: { inFlight: Boolean(isLoading) }

      })

    );

  }, [isLoading]);



  function normalizeName(s: string) {

    return String(s || "")

      .trim()

      .toLowerCase()

      .replace(/\s+/g, " ");

  }



  function detectComponentFromDescription(text: string): { component: string; assignee: string } | null {

    if (!text) return null;

    const normalizedText = normalizeName(text);



    const componentNames = Object.keys(COMPONENT_ASSIGNEES_BY_COMPONENT);

    

    // Common words to ignore when matching (too generic, would cause false positives)

    const ignoreWords = new Set(["search", "management", "reports", "chain", "details", "center", "gateway", "export", "doc", "manage"]);

    

    const matches: { component: string; assignee: string; priority: number; isExact: boolean }[] = [];



    for (const component of componentNames) {

      const normalizedComponent = normalizeName(component);

      const assignee = COMPONENT_ASSIGNEES_BY_COMPONENT[component];



      // Priority 1: Exact full component name match

      if (normalizedText.includes(normalizedComponent)) {

        matches.push({ component, assignee, priority: 1000 + normalizedComponent.length, isExact: true });

        continue;

      }



      // Priority 2: Match significant words from component name (excluding generic words)

      const words = normalizedComponent.split(/[\s\-_]+/).filter(w => w.length > 2 && !ignoreWords.has(w));

      for (const word of words) {

        const wordBoundaryRegex = new RegExp(`\\b${word}\\b`);

        if (wordBoundaryRegex.test(normalizedText)) {

          matches.push({ component, assignee, priority: word.length, isExact: false });

          break;

        }

      }

    }



    if (matches.length === 0) return null;



    // Sort by priority (exact matches first via higher priority, then by word length)

    matches.sort((a, b) => b.priority - a.priority);

    return { component: matches[0].component, assignee: matches[0].assignee };

  }



  function parsePromptJiraHints(prompt: string): PromptJiraHints {

    const text = String(prompt || "");



    const lineValue = (re: RegExp) => {

      const m = text.match(re);

      return m && m[1] ? String(m[1]).trim() : "";

    };



    const componentsRaw = lineValue(/^\s*-\s*Components\s*:\s*(.+)\s*$/mi);

    const parentKey = lineValue(/^\s*-\s*Parent\s*Key\s*:\s*(SE2-\d+)\s*$/mi);

    const sprintName =

      lineValue(/^\s*-\s*Current\s*Sprint\s*:\s*(.+)\s*$/mi) ||

      lineValue(/^\s*-\s*Sprint\s*:\s*(.+)\s*$/mi);

    const priorityName = lineValue(/^\s*-\s*Priority\s*:\s*(.+)\s*$/mi);

    const testCaseId = lineValue(/^\s*-\s*Test\s*Case\s*ID\s*:\s*(SE2-\d+)\s*$/mi);



    const components = componentsRaw

      ? componentsRaw

          .split(",")

          .map((s) => String(s || "").trim())

          .filter(Boolean)

      : [];



    return { components, parentKey, sprintName, priorityName, testCaseId };

  }



  function normalizePriorityName(value: string) {

    const v = String(value || "").trim().toLowerCase();

    if (!v) return "";



    if (v.includes("block")) return "Blocker";

    if (v.includes("critical") || v === "crit" || v === "p0") return "Critical";

    if (v.includes("major") || v === "high" || v === "p1") return "Major";

    if (v.includes("minor") || v === "medium" || v === "p2") return "Minor";

    if (v.includes("trivial") || v === "low" || v === "p3") return "Trivial";

    return "";

  }



  function inferPriorityFromText(text: string) {

    const t = normalizeName(text);

    if (!t) return "Minor";



    const has = (re: RegExp) => re.test(t);



    if (

      has(/\bblock(er|ing)?\b/) ||

      has(/\bcan\s*not\b/) ||

      has(/\bcannot\b/) ||

      has(/\bunable\b/) ||

      has(/\bwon't\s+work\b/) ||

      has(/\bstuck\b/) ||

      has(/\bhang\b/) ||

      has(/\bfreez(e|es|ing)\b/) ||

      has(/\bcrash\b/) ||

      has(/\bdata\s+loss\b/) ||

      has(/\bsecurity\b/) ||

      has(/\bproduction\b/) ||

      has(/\boutage\b/)

    ) {

      return "Blocker";

    }



    if (has(/\bcritical\b/) || has(/\bsev\s*1\b/) || has(/\bp0\b/)) return "Critical";

    if (has(/\bmajor\b/) || has(/\bsev\s*2\b/) || has(/\bp1\b/) || has(/\bfails?\b/) || has(/\berror\b/)) return "Major";

    if (has(/\bminor\b/) || has(/\bsev\s*3\b/) || has(/\bp2\b/)) return "Minor";

    if (has(/\btrivial\b/) || has(/\bcosmetic\b/) || has(/\btypo\b/) || has(/\bp3\b/)) return "Trivial";



    return "Minor";

  }



  function getRoutingText() {

    const parts: string[] = [];

    if (submittedQuestion) parts.push(submittedQuestion);

    if (report?.title) parts.push(report.title);

    if (report?.description) parts.push(report.description);

    if (report?.component) parts.push(report.component);

    return normalizeName(parts.join("\n"));

  }



  function applyAutoRouting() {

    if (!report) return;

    if (jiraUsers.length === 0 || jiraComponents.length === 0) return;



    const text = getRoutingText();



    // Do not override if user already chose values

    const canSetAssignee = !selectedAssignee && !isAssigneeEditing && !assigneeSearch.trim() && !assigneeManualOverrideRef.current;

    const canSetComponents = selectedComponents.length === 0 && !componentsManualOverrideRef.current;

    const canSetParent = !selectedParent.trim();

    const canSetRelatedTo = selectedRelatedToKeys.length === 0 && !relatedToManualOverrideRef.current;

    const canSetSprint = !selectedSprint.trim();



    let promptSetComponents = false;

    let promptSetParent = false;

    let promptSetRelatedTo = false;

    let promptSetSprint = false;



    if (canSetComponents && promptJiraHints.components.length > 0) {

      const findComponent = (name: string) => {

        const target = normalizeName(name);

        return (

          jiraComponents.find((c) => normalizeName(c.name) === target) ||

          jiraComponents.find((c) => normalizeName(c.name).includes(target)) ||

          jiraComponents.find((c) => target.includes(normalizeName(c.name)))

        );

      };



      const seen = new Set<string>();

      const comps = promptJiraHints.components

        .map((name) => findComponent(name))

        .filter(Boolean)

        .map((c: any) => ({ id: c.id, name: c.name }))

        .filter((c) => {

          if (!c?.id || seen.has(String(c.id))) return false;

          seen.add(String(c.id));

          return true;

        });



      if (comps.length > 0) {

        setSelectedComponents(comps);

        setComponentSearch("");

        setShowComponentList(false);

        promptSetComponents = true;

      }

    }



    if (canSetParent && promptJiraHints.parentKey) {

      setSelectedParent(promptJiraHints.parentKey);

      setParentSearch(promptJiraHints.parentKey);

      setShowParentList(false);

      promptSetParent = true;

    }



    if (canSetSprint && promptJiraHints.sprintName) {

      const target = normalizeName(promptJiraHints.sprintName);

      const sprint =

        jiraSprints.find((s) => normalizeName(s.name) === target) ||

        jiraSprints.find((s) => normalizeName(s.name).includes(target));

      if (sprint?.id) {

        setSelectedSprint(String(sprint.id));

        setSprintSearch(String(sprint.name || promptJiraHints.sprintName));

        setShowSprintList(false);

        promptSetSprint = true;

        lastRoutingSprintSearchRef.current = null;

      } else {

        setSprintSearch(promptJiraHints.sprintName);

        if (lastRoutingSprintSearchRef.current !== promptJiraHints.sprintName) {

          lastRoutingSprintSearchRef.current = promptJiraHints.sprintName;

          searchSprints(promptJiraHints.sprintName);

        }

      }

    }



    if (canSetRelatedTo) {

      const nextKeys = [promptJiraHints.testCaseId, promptJiraHints.parentKey].filter(Boolean) as string[];

      if (nextKeys.length > 0) {

        const deduped = Array.from(new Set(nextKeys));

        setSelectedRelatedToKeys(deduped);

        setRelatedToSearch("");

        setShowRelatedToList(false);

        promptSetRelatedTo = true;

      }

    }



    const containsAny = (keywords: string[]) => (text ? keywords.some((k) => text.includes(normalizeName(k))) : false);



    let assigneeName: string | null = null;

    let componentNames: string[] = [];



    if (promptJiraHints.components.length > 0) {

      const normalizedLookup = Object.entries(COMPONENT_ASSIGNEES_BY_COMPONENT).reduce(

        (acc, [component, assignee]) => {

          acc[normalizeName(component)] = String(assignee || "").trim();

          return acc;

        },

        {} as Record<string, string>

      );



      for (const c of promptJiraHints.components) {

        const hit = normalizedLookup[normalizeName(c)];

        if (hit) {

          assigneeName = hit;

          break;

        }

      }

    }



    const canUseHeuristic = promptJiraHints.components.length === 0;



    // // Priority order to avoid overlaps

    // if (!assigneeName && canUseHeuristic && containsAny(["BOM", "ACL", "AML"])) {

    //   assigneeName = "Ahmad Esmat";

    //   componentNames = ["BOM Manager", "ACL Management", "AML Management"];

    // } else if (!assigneeName && canUseHeuristic && containsAny(["supplychain", "supply chain"])) {

    //   assigneeName = "Ahmed Ghanem";

    //   componentNames = ["Supply Chain"];

    // } else if (!assigneeName && canUseHeuristic && containsAny(["Alert", "Admin"])) {

    //   assigneeName = "Awad Ayoub";

    //   componentNames = ["Admin", "Alert"];

    // } else if (!assigneeName && canUseHeuristic && containsAny(["supplier"])) {

    //   assigneeName = "Yasser Hosny";

    //   componentNames = ["Supplier"];

    // }



    // Auto-detect component from user's bug description when no components were explicitly provided

    if (!assigneeName && canUseHeuristic) {

      const routingText = [submittedQuestion, report?.title, report?.description, report?.component]

        .filter(Boolean)

        .join(" ");

      const detected = detectComponentFromDescription(routingText);

      if (detected) {

        assigneeName = detected.assignee;

        componentNames = [detected.component];

      }

    }



    if (assigneeName && canSetAssignee) {

      const target = normalizeName(assigneeName);



      // Try strict match first, then looser contains match (to handle middle names, initials, etc.)

      const user =

        jiraUsers.find((u) => normalizeName(u.displayName) === target) ||

        jiraUsers.find((u) => normalizeName(u.displayName).includes(target));



      if (user?.accountId) {

        setSelectedAssignee(user.accountId);

        setSelectedAssigneeLabel(user.displayName || "");

        setAssigneeSearch("");

        setShowAssigneeList(false);

        lastRoutingUserSearchRef.current = null;

      } else {

        // If the user isn't in the current list, trigger a Jira user search for the name.

        // This keeps token usage at 0 (no AI involvement) and is resilient to limited default user lists.

        if (lastRoutingUserSearchRef.current !== assigneeName) {

          lastRoutingUserSearchRef.current = assigneeName;

          searchAssignees(assigneeName);

          resolveAssigneeAndSelect(assigneeName);

        }

      }

    }



    if (componentNames.length > 0 && canSetComponents && !promptSetComponents && canUseHeuristic) {

      const comps = componentNames

        .map((name) => jiraComponents.find((c) => normalizeName(c.name) === normalizeName(name)))

        .filter(Boolean)

        .map((c: any) => ({ id: c.id, name: c.name }));



      if (comps.length > 0) {

        setSelectedComponents(comps);

        setComponentSearch("");

        setShowComponentList(false);

      }

    }

  }



  async function resolveIssueByKey(key: string) {

    try {

      const res = await fetch(`${API_BASE_URL}/jira/resolve-issue?key=${encodeURIComponent(key)}`);

      if (!res.ok) return null;

      const data = await res.json();

      const issue = data?.issue;

      if (!issue?.key) return null;

      return { key: String(issue.key), summary: String(issue.summary || "") } as JiraIssue;

    } catch {

      return null;

    }

  }



  async function resolveSprintByName(name: string) {

    try {

      const res = await fetch(`${API_BASE_URL}/jira/resolve-sprint?name=${encodeURIComponent(name)}`);

      if (!res.ok) return null;

      const data = await res.json();

      const sprint = data?.sprint;

      if (!sprint?.id) return null;

      return { id: String(sprint.id), name: String(sprint.name || ""), state: String(sprint.state || "") } as JiraSprint;

    } catch {

      return null;

    }

  }



  useEffect(() => {

    applyAutoRouting();

    // Intentionally include lists + selections so routing can apply once Jira data arrives

  }, [report, submittedQuestion, jiraUsers, jiraComponents, jiraSprints, promptJiraHints]);



  useEffect(() => {

    const keys = [promptJiraHints.testCaseId, promptJiraHints.parentKey].filter(Boolean) as string[];

    if (keys.length === 0) return;



    const signature = keys.join("|");

    if (lastIssueResolvePrefetchRef.current === signature) return;

    lastIssueResolvePrefetchRef.current = signature;



    (async () => {

      try {

        const resolved = await Promise.all(Array.from(new Set(keys)).map((k) => resolveIssueByKey(k)));

        const issues = resolved.filter(Boolean) as JiraIssue[];

        if (issues.length === 0) return;



        setJiraIssues((prev) => {

          const seen = new Set(prev.map((i) => i.key));

          const merged = [...prev];

          for (const i of issues) {

            if (!i?.key || seen.has(i.key)) continue;

            seen.add(i.key);

            merged.push(i);

          }

          return merged;

        });



        setRelatedToIssues((prev) => {

          const seen = new Set(prev.map((i) => i.key));

          const merged = [...prev];

          for (const i of issues) {

            if (!i?.key || seen.has(i.key)) continue;

            seen.add(i.key);

            merged.push(i);

          }

          return merged;

        });

      } catch {

        // Ignore resolver errors; user can still search manually.

      }

    })();

  }, [promptJiraHints.testCaseId, promptJiraHints.parentKey]);



  useEffect(() => {

    const name = String(promptJiraHints.sprintName || "").trim();

    if (!name) return;



    if (lastSprintResolvePrefetchRef.current === name) return;

    lastSprintResolvePrefetchRef.current = name;



    (async () => {

      const sprint = await resolveSprintByName(name);

      if (!sprint?.id) return;



      setJiraSprints((prev) => {

        const seen = new Set(prev.map((s) => String(s.id)));

        if (seen.has(String(sprint.id))) return prev;

        return [sprint, ...prev];

      });

    })();

  }, [promptJiraHints.sprintName]);



  useEffect(() => {

    function onPointerDown(e: PointerEvent) {

      const root = jiraSectionRef.current;

      if (!root) return;

      if (root.contains(e.target as Node)) return;



      setShowComponentList(false);

      setShowParentList(false);

      setShowRelatedToList(false);

      setShowSprintList(false);

      setShowAssigneeList(false);

    }



    window.addEventListener("pointerdown", onPointerDown);

    return () => window.removeEventListener("pointerdown", onPointerDown);

  }, []);



  async function fetchJiraData() {

    try {

      const [compRes, issuesRes, usersRes, sprintsRes, prioritiesRes] = await Promise.all([

        fetch(`${API_BASE_URL}/jira/components`),

        fetch(`${API_BASE_URL}/jira/issues`),

        fetch(`${API_BASE_URL}/jira/users`),

        fetch(`${API_BASE_URL}/jira/sprints`),

        fetch(`${API_BASE_URL}/jira/priorities`)

      ]);

      

      if (compRes.ok) {

        const compData = await compRes.json();

        setJiraComponents(compData.components || []);

      }

      

      if (issuesRes.ok) {

        const issuesData = await issuesRes.json();

        setJiraIssues(issuesData.issues || []);

      }



      if (usersRes.ok) {

        const usersData = await usersRes.json();

        setJiraUsers(usersData.users || []);

      }



      if (sprintsRes.ok) {

        const sprintsData = await sprintsRes.json();

        setJiraSprints(sprintsData.sprints || []);

      }



      if (prioritiesRes.ok) {

        const prioritiesData = await prioritiesRes.json();

        setJiraPriorities(prioritiesData.priorities || []);

      }

    } catch (e) {

      console.log("Jira not configured or unavailable");

    }

  }



  async function searchAssignees(query: string) {

    if (!query || query.length < 2) {

      const res = await fetch(`${API_BASE_URL}/jira/users`);

      if (res.ok) {

        const data = await res.json();

        setJiraUsers(data.users || []);

      }

      return;

    }

    try {

      const res = await fetch(`${API_BASE_URL}/jira/users?q=${encodeURIComponent(query)}`);

      if (res.ok) {

        const data = await res.json();

        setJiraUsers(data.users || []);

      }

    } catch (e) {

      console.log("Failed to search assignees");

    }

  }



  async function resolveAssigneeAndSelect(name: string) {

    try {

      const res = await fetch(`${API_BASE_URL}/jira/resolve-assignee?name=${encodeURIComponent(name)}`);

      if (!res.ok) return;

      const data = await res.json();

      const user = data?.user;

      if (user?.accountId) {

        setSelectedAssignee(String(user.accountId));

        setSelectedAssigneeLabel(String(user.displayName || ""));

        setAssigneeSearch("");

        setShowAssigneeList(false);

        setIsAssigneeEditing(false);

        lastRoutingUserSearchRef.current = null;

      }

    } catch {

      // Ignore resolver errors; user can still select manually.

    }

  }



  async function searchComponents(query: string) {

    if (!query || query.length < 2) {

      const res = await fetch(`${API_BASE_URL}/jira/components`);

      if (res.ok) {

        const data = await res.json();

        setJiraComponents(data.components || []);

      }

      return;

    }

    try {

      const res = await fetch(`${API_BASE_URL}/jira/components?q=${encodeURIComponent(query)}`);

      if (res.ok) {

        const data = await res.json();

        setJiraComponents(data.components || []);

      }

    } catch (e) {

      console.log("Failed to search components");

    }

  }



  function handleComponentSearchChange(value: string) {

    setComponentSearch(value);

    searchComponents(value);

  }



  function handleAssigneeSearchChange(value: string) {

    if (value.trim().length === 0) {

      assigneeManualOverrideRef.current = true;

      setSelectedAssignee("");

      setSelectedAssigneeLabel("");

    } else if (selectedAssignee) {

      assigneeManualOverrideRef.current = true;

      setSelectedAssignee("");

      setSelectedAssigneeLabel("");

    }

    setAssigneeSearch(value);

    searchAssignees(value);

  }



  function handleSelectComponent(value: string) {

    if (!value) return;

    const comp = jiraComponents.find(c => c.id === value);

    if (comp && !selectedComponents.find(c => c.id === value)) {

      setSelectedComponents([...selectedComponents, comp]);

    }

    componentsManualOverrideRef.current = true;

    setComponentSearch("");

    setShowComponentList(false);

  }



  function removeSelectedComponent(id: string) {

    componentsManualOverrideRef.current = true;

    setSelectedComponents((prev) => prev.filter((c) => c.id !== id));

  }



  function handleSelectAssignee(value: string) {

    if (!value) {

      // Treat placeholder selection as a no-op; do not clear the current assignee.

      // Keep the list open, and keep showing the current selection in the input.

      setIsAssigneeEditing(false);

      return;

    }

    assigneeManualOverrideRef.current = true;

    setSelectedAssignee(value);

    const user = jiraUsers.find((u) => u.accountId === value);

    setSelectedAssigneeLabel(user?.displayName || "");

    setAssigneeSearch("");

    setShowAssigneeList(false);

    setIsAssigneeEditing(false);

    requestAnimationFrame(() => {

      const el = document.activeElement as HTMLElement | null;

      if (el && typeof el.blur === "function") el.blur();

    });

  }



  function removeSelectedAssignee() {

    assigneeManualOverrideRef.current = true;

    setSelectedAssignee("");

    setSelectedAssigneeLabel("");

    setAssigneeSearch("");

    setIsAssigneeEditing(false);

  }



  function handleSelectParent(value: string) {

    if (!value) {

      setSelectedParent("");

      return;

    }

    setSelectedParent(value);

    setParentSearch(value);

    setShowParentList(false);

  }



  function removeSelectedParent() {

    setSelectedParent("");

    setParentSearch("");

  }



  function removeSelectedRelatedTo(key: string) {

    relatedToManualOverrideRef.current = true;

    setSelectedRelatedToKeys((prev) => prev.filter((k) => k !== key));

  }



  function handleComponentSearchFocus() {

    setShowComponentList(true);

    searchComponents(componentSearch);

  }



  function handleAssigneeSearchFocus() {

    assigneePrevRef.current = { id: selectedAssignee, label: selectedAssigneeLabel };

    setIsAssigneeEditing(true);

    setAssigneeSearch("");

    setShowAssigneeList(true);

    searchAssignees("");

  }



  function handleAssigneeSearchBlur() {

    window.setTimeout(() => {

      const wrap = assigneeWrapRef.current;

      const active = document.activeElement;

      if (wrap && active && wrap.contains(active)) return;



      setIsAssigneeEditing(false);

      setShowAssigneeList(false);

    }, 0);

  }



  function handleParentSearchFocus() {

    setShowParentList(true);

    searchParentIssues(parentSearch);

  }



  function handleSprintSearchFocus() {

    setShowSprintList(true);

    searchSprints(sprintSearch);

  }



  async function searchParentIssues(query: string) {

    if (!query || query.length < 2) {

      const res = await fetch(`${API_BASE_URL}/jira/issues`);

      if (res.ok) {

        const data = await res.json();

        setJiraIssues(data.issues || []);

      }

      return;

    }

    try {

      const res = await fetch(`${API_BASE_URL}/jira/issues?q=${encodeURIComponent(query)}`);

      if (res.ok) {

        const data = await res.json();

        setJiraIssues(data.issues || []);

      }

    } catch (e) {

      console.log("Failed to search parent issues");

    }

  }



  function handleParentSearchChange(value: string) {

    setParentSearch(value);

    searchParentIssues(value);

  }



  function handleRelatedToSearchFocus() {

    setShowRelatedToList(true);

    searchRelatedToIssues(relatedToSearch);

  }



  async function searchRelatedToIssues(query: string) {

    if (!query || query.length < 2) {

      const res = await fetch(`${API_BASE_URL}/jira/issues`);

      if (res.ok) {

        const data = await res.json();

        setRelatedToIssues(data.issues || []);

      }

      return;

    }

    try {

      const res = await fetch(`${API_BASE_URL}/jira/issues?q=${encodeURIComponent(query)}`);

      if (res.ok) {

        const data = await res.json();

        setRelatedToIssues(data.issues || []);

      }

    } catch (e) {

      console.log("Failed to search related issues");

    }

  }



  function handleRelatedToSearchChange(value: string) {

    setRelatedToSearch(value);

    searchRelatedToIssues(value);

  }



  function handleSelectRelatedTo(key: string) {

    if (!key) return;

    relatedToManualOverrideRef.current = true;

    setSelectedRelatedToKeys((prev) => {

      if (prev.includes(key)) return prev;

      return [...prev, key];

    });

    setRelatedToSearch("");

    setShowRelatedToList(false);

  }



  async function searchSprints(query: string) {

    if (!query || query.length < 2) {

      const res = await fetch(`${API_BASE_URL}/jira/sprints`);

      if (res.ok) {

        const data = await res.json();

        setJiraSprints(data.sprints || []);

      }

      return;

    }

    try {

      const res = await fetch(`${API_BASE_URL}/jira/sprints?q=${encodeURIComponent(query)}`);

      if (res.ok) {

        const data = await res.json();

        setJiraSprints(data.sprints || []);

      }

    } catch (e) {

      console.log("Failed to search sprints");

    }

  }



  function handleSprintSearchChange(value: string) {

    setSprintSearch(value);

    searchSprints(value);

  }



  function handleSelectSprint(value: string) {

    if (!value) {

      setSelectedSprint("");

      return;

    }

    setSelectedSprint(value);

    const sprint = jiraSprints.find((s) => String(s.id) === String(value));

    setSprintSearch(sprint?.name ? String(sprint.name) : String(value));

    setShowSprintList(false);

  }



  function removeSelectedSprint() {

    setSelectedSprint("");

    setSprintSearch("");

  }



  function addFiles(newFiles: FileList | File[]) {

    const validFiles: File[] = [];

    for (const f of Array.from(newFiles)) {

      if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {

        setError("Only image and video files are supported.");

        continue;

      }

      validFiles.push(f);

    }

    if (validFiles.length === 0) return;

    

    setError(null);

    setFiles((prev) => [...prev, ...validFiles]);

    

    validFiles.forEach((f) => {

      if (f.type.startsWith("image/")) {

        const reader = new FileReader();

        reader.onload = (e) => {

          setImagePreviews((prev) => [...prev, e.target?.result as string]);

        };

        reader.readAsDataURL(f);

      } else if (f.type.startsWith("video/")) {

        setImagePreviews((prev) => [...prev, `video:${f.name}`]);

      }

    });

  }



  function removeFile(index: number) {

    setFiles((prev) => prev.filter((_, i) => i !== index));

    setImagePreviews((prev) => prev.filter((_, i) => i !== index));

  }



  function clearFiles() {

    setFiles([]);

    setImagePreviews([]);

  }



  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {

    const items = e.clipboardData?.items;

    if (!items?.length) return;

    const pastedFiles: File[] = [];

    for (const item of items) {

      if (item.kind === "file" && item.type?.startsWith("image/")) {

        const pasted = item.getAsFile();

        if (!pasted) continue;

        const ext = pasted.type?.split("/")?.[1] || "png";

        const normalized = new File([pasted], `pasted-image-${Date.now()}.${ext}`, { type: pasted.type });

        pastedFiles.push(normalized);

      }

    }

    if (pastedFiles.length > 0) {

      addFiles(pastedFiles);

    }

  }



  async function handleSubmit() {

    if (input.trim().length < 3 || isLoading) return;



    setReport(null);

    setDeletedReportFields({});

    setJiraResult(null);

    setSelectedComponents([]);

    componentsManualOverrideRef.current = false;

    relatedToManualOverrideRef.current = false;

    assigneeManualOverrideRef.current = false;

    lastIssueResolvePrefetchRef.current = "";

    lastSprintResolvePrefetchRef.current = "";

    setSelectedAssignee("");

    setSelectedAssigneeLabel("");

    setIsAssigneeEditing(false);

    assigneePrevRef.current = null;

    lastRoutingUserSearchRef.current = null;

    lastRoutingSprintSearchRef.current = null;

    setSelectedParent("");

    setSelectedRelatedToKeys([]);

    setSelectedSprint("");

    setSelectedJiraPriority("");

    setJiraComment("");

    setComponentSearch("");

    setAssigneeSearch("");

    setParentSearch("");

    setRelatedToSearch("");

    setSprintSearch("");

    setShowComponentList(false);

    setShowAssigneeList(false);

    setShowParentList(false);

    setShowRelatedToList(false);

    setShowSprintList(false);

    setConversationHistory([]);



    setError(null);

    setToast(null);

    setIsLoading(true);

    setStreamingText("");

    

    // Reset auto-scroll to ensure mainArea scrolls to bottom on new submission

    mainAreaAutoScrollRef.current = true;

    

    if (files.length > 0) {

      setSubmittedImagePreviews(imagePreviews);

      setSubmittedFiles(files);

    }



    const currentFiles = files;

    const description = input.trim();



    setPromptJiraHints(parsePromptJiraHints(description));



    setSubmittedQuestion(description);

    setInput("");

    clearFiles();



    setChatMessages(prev => [...prev, { role: "user", content: description }]);



    try {

      const form = new FormData();

      form.append("description", description);

      currentFiles.forEach((f) => form.append("images", f));

      

      



      const res = await fetch(`${API_BASE_URL}/generate-stream`, {

        method: "POST",

        body: form,

      });



      if (!res.ok) {

        if (res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) {

          throw new Error("SERVER_UNREACHABLE");

        }

        const errorData = await res.json().catch(() => ({}));

        throw new Error(errorData?.error || `Request failed (${res.status})`);

      }



      const reader = res.body?.getReader();

      if (!reader) {

        throw new Error("Streaming not supported");

      }



      const decoder = new TextDecoder();

      let buffer = "";

      let accumulatedText = "";

      let finalReport: BugReport | null = null;

      let lastUiUpdateAt = 0;



      while (true) {

        const { done, value } = await reader.read();

        if (done) break;



        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");

        buffer = lines.pop() || "";



        for (const line of lines) {

          const trimmed = line.trim();

          if (!trimmed || !trimmed.startsWith("data: ")) continue;



          try {

            const data = JSON.parse(trimmed.slice(6));

            

            if (data.type === "chunk" && data.content) {

              accumulatedText += data.content;

              const now = Date.now();

              if (now - lastUiUpdateAt > 80) {

                lastUiUpdateAt = now;

                setStreamingText(accumulatedText);

              }

            } else if (data.type === "complete" && data.report) {

              finalReport = data.report;

            } else if (data.type === "error") {

              throw new Error(data.error || "Stream error");

            }

          } catch (parseErr: any) {

            if (parseErr.message && !parseErr.message.includes("JSON")) {

              throw parseErr;

            }

          }

        }

      }



      if (finalReport) {

        setReport(finalReport);

        setChatMessages(prev => [...prev, { role: "assistant", content: accumulatedText, report: finalReport }]);

        setStreamingText("");



        if (!selectedJiraPriority) {

          const fromReport = normalizePriorityName((finalReport as any)?.jiraPriority);

          const fromPrompt = normalizePriorityName(promptJiraHints?.priorityName || "");

          const inferred = inferPriorityFromText(

            [submittedQuestion, (finalReport as any)?.title, (finalReport as any)?.description, (finalReport as any)?.impact]

              .filter(Boolean)

              .join("\n")

          );

          // Always set a priority - never leave blank. Default to "Minor" as fallback.

          setSelectedJiraPriority(fromReport || fromPrompt || inferred || "Minor");

        }



        suppressAutoScrollRef.current = true;

        requestAnimationFrame(() => {

          const container = editableReportRef.current;

          if (container) {

            container.scrollIntoView({ behavior: "smooth", block: "start" });

          } else {

            reportTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

          }



          window.setTimeout(() => {

            if (editableTitleRef.current && !editableTitleRef.current.disabled) {

              editableTitleRef.current.focus();

            }

          }, 0);

        });

      } else {

        throw new Error("No report received from server");

      }

    } catch (e: any) {

      const msg = String(e?.message || "");

      const isFetchFailed =

        e?.message === "Failed to fetch" ||

        e?.name === "TypeError" ||

        e?.message === "SERVER_UNREACHABLE" ||

        msg.toLowerCase().includes("fetch failed");



      if (isFetchFailed) {

        showErrorToast(

          "Unable to connect to AI. Please check the backend server/VPN and try again."

        );



        setInput(description);

        requestAnimationFrame(() => {

          const el = inputTextareaRef.current;

          if (!el) return;

          const needed = el.scrollHeight;

          const clamped = Math.max(DEFAULT_INPUT_HEIGHT, Math.min(260, needed));

          setInputHeight(clamped);

        });

        setSubmittedQuestion(null);

        setChatMessages((prev) => {

          const last = prev[prev.length - 1];

          if (last && last.role === "user" && last.content === description) return prev.slice(0, -1);

          return prev;

        });

      } else {

        setError(e?.message || "Unexpected error");

      }

      setStreamingText("");

    } finally {

      setIsLoading(false);

    }

  }



  function startNewConversation() {

    setReport(null);

    setConversationHistory([]);

    setChatMessages([]);

    setSubmittedQuestion(null);

    setSubmittedImagePreviews([]);

    setSubmittedFiles([]);

    setJiraResult(null);

    setDeletedReportFields({});

    setError(null);

    setSelectedComponents([]);

    setSelectedAssignee("");

    setSelectedParent("");

    setSelectedRelatedToKeys([]);

    setSelectedSprint("");

    setSelectedJiraPriority("");

    setJiraComment("");

    setComponentSearch("");

    setAssigneeSearch("");

    setRelatedToSearch("");

    setParentSearch("");

    setSprintSearch("");

  }



  async function handleUploadToJira() {

    if (!report || jiraLoading) return;



    const missing: string[] = [];

    if (!String(report.title || "").trim()) missing.push("Title");

    if (selectedComponents.length === 0) missing.push("Component");

    if (!selectedAssignee) missing.push("Assignee");



    if (missing.length > 0) {

      setError(`Please fill required fields: ${missing.join(", ")}.`);

      return;

    }



    setJiraLoading(true);

    setError(null);



    try {

      const form = new FormData();

      form.append("report", JSON.stringify(report));

      if (selectedComponents.length > 0) {

        selectedComponents.forEach(c => form.append("componentIds", c.id));

      }

      if (selectedParent) form.append("parentKey", selectedParent);

      if (selectedRelatedToKeys.length > 0) {

        selectedRelatedToKeys.forEach((k) => form.append("relatedToKeys", k));

      }

      if (selectedAssignee) form.append("assigneeId", selectedAssignee);

      if (selectedSprint) form.append("sprintId", selectedSprint);

      if (selectedJiraPriority) form.append("jiraPriority", selectedJiraPriority);

      if (jiraComment.trim()) form.append("comment", jiraComment.trim());

      submittedFiles.forEach((f) => form.append("images", f));



      const res = await fetch(`${API_BASE_URL}/jira/create`, {

        method: "POST",

        body: form,

      });



      const data = await res.json();



      if (!res.ok) {

        throw new Error(data?.error || `Failed to create JIRA Bug`);

      }



      setJiraResult({ url: data.jiraUrl, key: data.issueKey });

    } catch (e: any) {

      if (e?.message === "Failed to fetch" || e?.name === "TypeError") {

        setError("Unable to connect to the server. Please check your VPN connection or contact the administrator if the problem persists.");

      } else {

        setError(e?.message || "Failed to upload to Jira");

      }

    } finally {

      setJiraLoading(false);

    }

  }



  function updateReport(field: keyof BugReport, value: string | string[]) {

    setReport((prev) => {

      if (!prev) return prev;



      if (Array.isArray(value)) {

        return { ...prev, [field]: value };

      }



      const normalized = String(value ?? "");

      return { ...prev, [field]: normalized };

    });

  }



  function updateStep(idx: number, value: string) {

    if (!report) return;

    const newSteps = [...report.stepsToReproduce];

    newSteps[idx] = value;

    setReport({ ...report, stepsToReproduce: newSteps });

  }



  function addStep() {

    if (!report) return;

    setReport({ ...report, stepsToReproduce: [...report.stepsToReproduce, ""] });

  }



  function removeStep(idx: number) {

    if (!report) return;

    const newSteps = report.stepsToReproduce.filter((_, i) => i !== idx);

    setReport({ ...report, stepsToReproduce: newSteps });

  }



  function renderReport(r: BugReport, isEditable: boolean = false) {

    if (isEditable) {

      const canShowDescription = !deletedReportFields.description;

      const canShowEnvironment = !deletedReportFields.environment;

      const canShowReproducibility = !deletedReportFields.reproducibility;

      const canShowImpact = !deletedReportFields.impact;

      const canShowWorkaround = !deletedReportFields.workaround;



      const deletedButtons = [

        !canShowDescription ? { key: "description", label: "Description" } : null,

        !canShowEnvironment ? { key: "environment", label: "Environment" } : null,

        !canShowReproducibility ? { key: "reproducibility", label: "Reproducibility" } : null,

        !canShowImpact ? { key: "impact", label: "Impact" } : null,

        !canShowWorkaround ? { key: "workaround", label: "Workaround" } : null

      ].filter(Boolean) as Array<{ key: string; label: string }>;



      return (

        <div className="reportContent editable" ref={editableReportRef}>

          <div className="editableField">

            <label>Title *</label>

            <input

              type="text"

              className="editInput"

              ref={editableTitleRef}

              value={r.title}

              onChange={(e) => updateReport("title", e.target.value)}

            />

          </div>



          {deletedButtons.length > 0 && (

            <div className="editableField">

              {deletedButtons.map((b) => (

                <button

                  key={b.key}

                  type="button"

                  className="addStepBtn"

                  onClick={() =>

                    setDeletedReportFields((prev) => ({

                      ...prev,

                      [b.key]: false

                    }))

                  }

                >

                  + Add {b.label}

                </button>

              ))}

            </div>

          )}



          {canShowDescription && (

            <div className="editableField">

              <div className="editableLabelRow">

                <label>Description</label>

                <button

                  type="button"

                  className="clearFieldBtn"

                  onClick={() => {

                    updateReport("description", "");

                    setDeletedReportFields((prev) => ({ ...prev, description: true }));

                  }}

                >

                  ✕

                </button>

              </div>

              <AutoResizeEditTextarea value={r.description || ""} onChange={(v) => updateReport("description", v)} rows={2} />

            </div>

          )}



          <div className="editableField">

            <label>Steps to Reproduce</label>

            {r.stepsToReproduce?.map((s: string, idx: number) => (

              <div key={idx} className="stepRow">

                <span className="stepNumber">{idx + 1}.</span>

                <input

                  type="text"

                  className="editInput stepInput"

                  value={s}

                  onChange={(e) => updateStep(idx, e.target.value)}

                />

                <button type="button" className="removeStepBtn" onClick={() => removeStep(idx)}>✕</button>

              </div>

            ))}

            <button type="button" className="addStepBtn" onClick={addStep}>+ Add Step</button>

          </div>



          <div className="editableField">

            <label>Expected Result</label>

            <AutoResizeEditTextarea value={r.expectedResult || ""} onChange={(v) => updateReport("expectedResult", v)} rows={2} />

          </div>



          <div className="editableField">

            <label>Actual Result</label>

            <AutoResizeEditTextarea value={r.actualResult || ""} onChange={(v) => updateReport("actualResult", v)} rows={2} />

          </div>



          {canShowEnvironment && (

            <div className="editableField">

              <div className="editableLabelRow">

                <label>Environment</label>

                <button

                  type="button"

                  className="clearFieldBtn"

                  onClick={() => {

                    updateReport("environment", "");

                    setDeletedReportFields((prev) => ({ ...prev, environment: true }));

                  }}

                >

                  ✕

                </button>

              </div>

              <input

                type="text"

                className="editInput"

                value={r.environment || ""}

                onChange={(e) => updateReport("environment", e.target.value)}

              />

            </div>

          )}



          {canShowReproducibility && (

            <div className="editableField">

              <div className="editableLabelRow">

                <label>Reproducibility</label>

                <button

                  type="button"

                  className="clearFieldBtn"

                  onClick={() => {

                    updateReport("reproducibility", "");

                    setDeletedReportFields((prev) => ({ ...prev, reproducibility: true }));

                  }}

                >

                  ✕

                </button>

              </div>

              <select

                className="editSelect"

                value={r.reproducibility || ""}

                onChange={(e) => updateReport("reproducibility", e.target.value)}

              >

                <option value="">-- Select --</option>

                <option value="Always">Always</option>

                <option value="Sometimes">Sometimes</option>

                <option value="Rarely">Rarely</option>

              </select>

            </div>

          )}



          {canShowImpact && (

            <div className="editableField">

              <div className="editableLabelRow">

                <label>Impact</label>

                <button

                  type="button"

                  className="clearFieldBtn"

                  onClick={() => {

                    updateReport("impact", "");

                    setDeletedReportFields((prev) => ({ ...prev, impact: true }));

                  }}

                >

                  ✕

                </button>

              </div>

              <AutoResizeEditTextarea value={r.impact || ""} onChange={(v) => updateReport("impact", v)} rows={2} />

            </div>

          )}



          {canShowWorkaround && (

            <div className="editableField">

              <div className="editableLabelRow">

                <label>Workaround</label>

                <button

                  type="button"

                  className="clearFieldBtn"

                  onClick={() => {

                    updateReport("workaround", "");

                    setDeletedReportFields((prev) => ({ ...prev, workaround: true }));

                  }}

                >

                  ✕

                </button>

              </div>

              <AutoResizeEditTextarea value={r.workaround || ""} onChange={(v) => updateReport("workaround", v)} rows={2} />

            </div>

          )}



          {submittedImagePreviews.length > 0 && (

            <div className="reportSection">

              <div className="reportSectionTitle">Attachments ({submittedImagePreviews.length})</div>

              <div className="attachedImages">

                {submittedImagePreviews.map((src, idx) => (

                  src.startsWith("video:") ? (

                    <div key={idx} className="attachedVideo">

                      <span className="videoIcon">🎬</span>

                      <span>{src.replace("video:", "")}</span>

                    </div>

                  ) : (

                    <img key={idx} src={src} alt={`Screenshot ${idx + 1}`} className="attachedImage" />

                  )

                ))}

              </div>

            </div>

          )}

        </div>

      );

    }



    return (

      <div className="reportContent">

        <div className="reportTitle">{r.title}</div>



        {r.description && (

          <div className="reportDescription">{r.description}</div>

        )}



        <div className="reportSection">

          <div className="reportSectionTitle">Steps to Reproduce</div>

          <div className="reportSectionContent">

            {r.stepsToReproduce?.length ? (

              <ol className="steps">

                {r.stepsToReproduce.map((s: string, idx: number) => (

                  <li key={idx}>{s}</li>

                ))}

              </ol>

            ) : (

              "—"

            )}

          </div>

        </div>



        <div className="reportSection">

          <div className="reportSectionTitle">Expected Result</div>

          <div className="reportSectionContent">{r.expectedResult || "—"}</div>

        </div>



        <div className="reportSection">

          <div className="reportSectionTitle">Actual Result</div>

          <div className="reportSectionContent">{r.actualResult || "—"}</div>

        </div>



        <div className="reportSection">

          <div className="reportSectionTitle">Environment</div>

          <div className="reportSectionContent">{r.environment || "—"}</div>

        </div>



        {r.reproducibility && (

          <div className="reportSection">

            <div className="reportSectionTitle">Reproducibility</div>

            <div className="reportSectionContent">{r.reproducibility}</div>

          </div>

        )}



        {r.impact && (

          <div className="reportSection">

            <div className="reportSectionTitle">Impact</div>

            <div className="reportSectionContent">{r.impact}</div>

          </div>

        )}



        {r.workaround && (

          <div className="reportSection">

            <div className="reportSectionTitle">Workaround</div>

            <div className="reportSectionContent">{r.workaround}</div>

          </div>

        )}



        {submittedImagePreviews.length > 0 && (

          <div className="reportSection">

            <div className="reportSectionTitle">Attachments ({submittedImagePreviews.length})</div>

            <div className="attachedImages">

              {submittedImagePreviews.map((src, idx) => (

                src.startsWith("video:") ? (

                  <div key={idx} className="attachedVideo">

                    <span className="videoIcon">🎬</span>

                    <span>{src.replace("video:", "")}</span>

                  </div>

                ) : (

                  <img key={idx} src={src} alt={`Screenshot ${idx + 1}`} className="attachedImage" />

                )

              ))}

            </div>

          </div>

        )}

      </div>

    );

  }



  const lastAssistantReportIndex = (() => {

    for (let i = chatMessages.length - 1; i >= 0; i--) {

      if (chatMessages[i]?.role === "assistant" && chatMessages[i]?.report) return i;

    }

    return -1;

  })();



  return (

    <div className="app">

      <div className="header" ref={headerRef}>

        <h1 className="headerBrand">

          <svg

            className="headerBrandIcon"

            width="28"

            height="28"

            viewBox="0 0 512 512"

            xmlns="http://www.w3.org/2000/svg"

            role="img"

            aria-label="BugGenAI"

          >

            <path

              fill="#2f6fed"

              d="M0,256.006C0,397.402,114.606,512.004,255.996,512C397.394,512.004,512,397.402,512,256.006 C512.009,114.61,397.394,0,255.996,0C114.606,0,0,114.614,0,256.006z"

            />

            <path

              fill="#1e5fbf"

              d="M508.474,298.224c-0.372-0.479-0.773-0.925-1.279-1.279 c-0.413-0.585-111.022-111.199-111.612-111.612c-1.154-1.633-2.992-2.746-5.184-2.746c-1.014,0-1.939,0.3-2.791,0.738 c-0.249-0.247-0.582-0.383-0.868-0.586c-0.417-0.585-0.903-1.073-1.489-1.489c-0.415-0.583-72.334-72.502-72.918-72.918 c-1.161-1.632-2.973-2.765-5.126-2.765c-14.065,0-25.489,10.378-25.953,23.266c-7.852-2.547-16.345-4.002-25.252-4.002 c-6.419,0-12.515,0.977-18.419,2.352c-0.086-0.077-0.19-0.133-0.277-0.207c-0.491-0.503-11.371-11.441-11.905-11.905 c-0.491-0.506-0.954-1.023-1.488-1.488c-4.749-4.878-11.545-8.014-19.198-8.014c-3.534,0-6.4,2.863-6.4,6.401 c0,2.154,1.133,3.965,2.763,5.125c0.415,0.583,15.451,17.798,15.362,18.002c-18.596,10.662-30.837,28.607-30.837,48.916 c0,4.753,0.741,9.487,2.123,14.148c-8.951,5.972-16.738,14.383-22.319,25.76c-0.4-0.542-36.542-36.688-37.132-37.099 c-0.413-0.586-0.898-1.077-1.488-1.489c-1.154-1.633-2.992-2.746-5.184-2.746c-3.535,0-6.4,3.02-6.4,6.556 c0,16.791,7.279,32.116,18.951,42.455c0.509,0.487,0.962,1.023,1.489,1.489c0.507,0.485,21.329,21.403,21.606,21.657 c-0.276,3.31-0.449,6.737-0.449,10.354c0,2.567,0.091,5.156,0.223,7.75c-0.133,0.073-0.283,0.076-0.413,0.156l-12.588,7.863 c-11.035,6.895-19.038,17.863-22.535,30.895l-6.067,22.612c-0.721,2.688,0.422,5.382,2.59,6.875 c0.418,0.571,29.924,29.946,30.001,30.039c-0.37,2.182-0.81,4.367-0.81,6.542v22.201c0,2.154,1.133,3.965,2.763,5.125 c0.415,0.583,105.073,105.243,105.658,105.659c0.325,0.459,0.739,0.814,1.166,1.164 C383.443,511.599,488.383,419.263,508.474,298.224z"

            />

            <path

              fill="#eef6ff"

              d="M396.8,189.143v-0.313c0-3.537-2.866-6.244-6.4-6.244s-6.4,3.019-6.4,6.556 c0,20.612-14.01,38.387-33.315,42.269c-0.235,0.047-0.413,0.196-0.636,0.267c-5.478-15.6-14.86-26.238-25.771-33.518 c1.382-4.661,2.123-9.395,2.123-14.149c0-20.347-12.283-38.324-30.939-48.979c-0.082-0.18-0.083-0.377-0.182-0.551 c-0.871-1.525-1.312-3.156-1.312-4.857c0-6.206,5.94-11.257,13.241-11.257c3.534,0,6.4-2.863,6.4-6.4s-2.866-6.4-6.4-6.4 c-14.066,0-25.49,10.375-25.954,23.266c-7.851-2.548-16.345-4.003-25.252-4.003c-8.938,0-17.458,1.462-25.331,4.028 c-0.449-12.9-11.882-23.29-25.956-23.29c-3.534,0-6.4,2.863-6.4,6.4c0,3.537,2.866,6.4,6.4,6.4c7.3,0,13.241,5.05,13.241,11.257 c0,1.7-0.441,3.331-1.31,4.85c-0.113,0.197-0.117,0.417-0.206,0.622c-18.597,10.662-30.837,28.607-30.837,48.915 c0,4.754,0.74,9.488,2.123,14.149c-10.912,7.28-20.293,17.918-25.771,33.518c-0.223-0.071-0.401-0.221-0.636-0.267 c-19.307-3.882-33.315-21.657-33.315-42.269v-0.313c0-3.537-2.866-6.244-6.4-6.244c-3.534,0-6.4,3.019-6.4,6.556 c0,26.645,18.278,49.66,43.472,54.789c-1.213,6.372-1.872,13.405-1.872,21.167c0,2.567,0.091,5.155,0.222,7.75 c-0.133,0.071-0.283,0.075-0.413,0.156l-12.588,7.862c-11.035,6.894-19.038,17.862-22.534,30.894l-6.068,22.612 c-0.915,3.412,1.109,6.918,4.522,7.838c0.556,0.15,1.116,0.219,1.663,0.219c2.825,0,5.412-1.882,6.178-4.743l6.068-22.606 c2.656-9.893,8.675-18.188,16.954-23.362l7.566-4.725c2.233,16.209,6.82,32.468,13.334,47.558l-6.466,6.629 c-11.631,10.944-18.037,23.956-18.037,36.65v22.201c0,3.537,2.866,6.4,6.4,6.4s6.4-2.863,6.4-6.4V377.83 c0-8.994,5.106-18.95,14.203-27.519l3.381-3.465c17.966,34.112,46.08,59.583,78.416,59.583c32.337,0,60.451-25.472,78.417-59.586 l3.577,3.661c8.9,8.375,14.006,18.332,14.006,27.325v22.201c0,3.537,2.866,6.4,6.4,6.4c3.534,0,6.4-2.863,6.4-6.4v-22.201 c0-12.693-6.406-25.707-17.841-36.457l-6.662-6.825c6.515-15.09,11.102-31.348,13.334-47.557l7.566,4.725 c8.278,5.175,14.297,13.469,16.954,23.356l6.068,22.612c0.766,2.863,3.354,4.743,6.178,4.743c0.547,0,1.106-0.068,1.663-0.219 c3.412-0.918,5.438-4.425,4.522-7.838l-6.068-22.619c-3.497-13.025-11.5-23.994-22.534-30.887l-12.588-7.862 c-0.13-0.081-0.279-0.084-0.413-0.156c0.131-2.595,0.222-5.184,0.222-7.75c0-7.762-0.659-14.795-1.872-21.167 C378.522,238.803,396.8,215.789,396.8,189.143z M198.4,184.013c0-25.575,25.841-46.381,57.6-46.381s57.6,20.806,57.6,46.381 c0,2.606-0.331,5.222-0.901,7.822c-21.213-9.374-44.823-9.403-56.699-9.403c-11.875,0-35.486,0.03-56.699,9.403 C198.731,189.234,198.4,186.619,198.4,184.013z M169.6,265.1c0-25.326,7.405-43.231,22.975-54.601l0.037,0.087l6.156-3.325 c12.756-6.877,29.479-10.922,48.739-11.833c0.684-0.026,1.401-0.03,2.092-0.049v197.781C204.755,387.274,169.6,320.697,169.6,265.1z M262.4,393.163V195.381c0.692,0.019,1.409,0.023,2.092,0.049c19.26,0.911,35.983,4.956,48.739,11.833l6.156,3.325l0.037-0.087 c15.571,11.369,22.976,29.274,22.976,54.599C342.4,320.697,307.245,387.274,262.4,393.163z"

            />

          </svg>

          BugGenAI

        </h1>

        <div className="tabs" role="tablist" aria-label="Apps">

          <button

            type="button"

            className={`tab ${activeTab === "zephyr" ? "active" : ""}`}

            role="tab"

            aria-selected={activeTab === "zephyr"}

            onClick={() => setActiveTab("zephyr")}

          >

            Failed Test Cases

          </button>

          <button

            type="button"

            className={`tab ${activeTab === "ai" ? "active" : ""}`}

            role="tab"

            aria-selected={activeTab === "ai"}

            onClick={() => setActiveTab("ai")}

          >

            Bug AI Generator

          </button>

        </div>

        <div className="headerRight">

          {activeTab === "ai" && report && (

            <button className="newConversationButton" onClick={startNewConversation}>

              + New Report

            </button>

          )}

          <div className="aiPoweredBadge" aria-label="AI-Powered">

            <svg className="aiPoweredIcon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">

              <path

                fill="currentColor"

                d="M12 2l1.1 3.8L17 7l-3.9 1.2L12 12l-1.1-3.8L7 7l3.9-1.2L12 2Zm7 7 1 2.7L23 12l-3 1.3L19 16l-1-2.7L15 12l3-1.3L19 9ZM6 13l1.2 3.4L11 18l-3.8 1.6L6 23l-1.2-3.4L1 18l3.8-1.6L6 13Z"

              />

            </svg>

            <span className="aiPoweredText">AI-Powered</span>

          </div>

        </div>

      </div>



      {toast && (

        <div

          className="toast toastError"

          role="status"

          aria-live="polite"

          style={{ top: Math.max(16, headerHeight + 12) }}

        >

          <div className="toastText">{toast.message}</div>

          <button

            type="button"

            className="toastClose"

            onClick={() => setToast(null)}

            aria-label="Close"

          >

            ✕

          </button>

        </div>

      )}



      <div className="mainArea" ref={mainAreaRef} onScroll={handleMainAreaScroll}>

        <div

          className="zephyrFrameWrap"

          aria-hidden={activeTab !== "zephyr"}

          style={

            activeTab === "zephyr"

              ? { display: "block" }

              : { position: "absolute", width: 0, height: 0, overflow: "hidden", padding: 0, border: "none" }

          }

        >

          <ZephyrPanel isActive={activeTab === "zephyr"} />

        </div>



        <div className="resultArea" style={{ display: activeTab === "ai" ? "block" : "none" }}>

          <div ref={reportTopRef} />

          {chatMessages.map((msg, idx) => (

            <div key={idx}>

              {msg.role === "user" ? (

                <div className="userQuestion">

                  <div className="questionLabel">You:</div>

                  <div className="questionText">{msg.content}</div>

                </div>

              ) : msg.report ? (

                idx === lastAssistantReportIndex && report ? (

                  <>

                    {renderReport(report, true)}



                    {!jiraResult && (

                      <div className="jiraSection" ref={jiraSectionRef}>

                        <div className="jiraSectionTitle">Upload to JIRA</div>



                        <div className="jiraOptions">

                          <div className="jiraOption">

                            <label>Components *</label>

                            <input

                              type="text"

                              className="searchInput"

                              placeholder="Search components..."

                              value={componentSearch}

                              onChange={(e) => handleComponentSearchChange(e.target.value)}

                              onFocus={handleComponentSearchFocus}

                              disabled={jiraLoading}

                            />

                            {selectedComponents.length > 0 && (

                              <div className="selectedItems">

                                {selectedComponents.map((c) => (

                                  <div key={c.id} className="selectedItem">

                                    <span>{c.name}</span>

                                    <button type="button" className="removeItem" onClick={() => removeSelectedComponent(c.id)}>✕</button>

                                  </div>

                                ))}

                              </div>

                            )}

                            {showComponentList && (

                              <select

                                value=""

                                onChange={(e) => handleSelectComponent(e.target.value)}

                                disabled={jiraLoading}

                                size={5}

                                className="searchableSelect"

                              >

                                <option value="">-- Select Component --</option>

                                {jiraComponents.map((c) => (

                                  <option key={c.id} value={c.id}>{c.name}</option>

                                ))}

                              </select>

                            )}

                          </div>



                          <div className="jiraOption" ref={assigneeWrapRef}>

                            <label>Assignee *</label>

                            <input

                              type="text"

                              className="searchInput"

                              placeholder="Search users..."

                              value={isAssigneeEditing ? assigneeSearch : (selectedAssigneeLabel || assigneeSearch)}

                              onChange={(e) => handleAssigneeSearchChange(e.target.value)}

                              onFocus={handleAssigneeSearchFocus}

                              onBlur={handleAssigneeSearchBlur}

                              disabled={jiraLoading}

                            />

                            {showAssigneeList && (

                              <select

                                value={selectedAssignee}

                                onChange={(e) => handleSelectAssignee(e.target.value)}

                                disabled={jiraLoading}

                                size={5}

                                className="searchableSelect"

                              >

                                <option value="">-- Select Assignee --</option>

                                {selectedAssignee && !jiraUsers.some((u) => u.accountId === selectedAssignee) && (

                                  <option value={selectedAssignee}>

                                    {selectedAssigneeLabel || selectedAssignee}

                                  </option>

                                )}

                                {jiraUsers.map((u) => (

                                  <option key={u.accountId} value={u.accountId}>{u.displayName}</option>

                                ))}

                              </select>

                            )}

                          </div>



                          <div className="jiraOption">

                            <label>Parent Issue</label>

                            <input

                              type="text"

                              className="searchInput"

                              placeholder="Search parent issue..."

                              value={parentSearch}

                              onChange={(e) => handleParentSearchChange(e.target.value)}

                              onFocus={handleParentSearchFocus}

                              disabled={jiraLoading}

                            />

                            {showParentList && (

                              <select

                                value={selectedParent}

                                onChange={(e) => handleSelectParent(e.target.value)}

                                disabled={jiraLoading}

                                size={5}

                                className="searchableSelect"

                              >

                                <option value="">-- Select Parent --</option>

                                {jiraIssues.map((i) => (

                                  <option key={i.key} value={i.key}>{i.key} - {i.summary}</option>

                                ))}

                              </select>

                            )}

                          </div>



                          <div className="jiraOption">

                            <label>Related To</label>

                            <input

                              type="text"

                              className="searchInput"

                              placeholder="Search related issue..."

                              value={relatedToSearch}

                              onChange={(e) => handleRelatedToSearchChange(e.target.value)}

                              onFocus={handleRelatedToSearchFocus}

                              disabled={jiraLoading}

                            />

                            {selectedRelatedToKeys.length > 0 && (

                              <div className="selectedItems">

                                {selectedRelatedToKeys.map((k) => (

                                  <div key={k} className="selectedItem">

                                    <span>{k}</span>

                                    <button type="button" className="removeItem" onClick={() => removeSelectedRelatedTo(k)}>✕</button>

                                  </div>

                                ))}

                              </div>

                            )}

                            {showRelatedToList && (

                              <select

                                value=""

                                onChange={(e) => handleSelectRelatedTo(e.target.value)}

                                disabled={jiraLoading}

                                size={5}

                                className="searchableSelect"

                              >

                                <option value="">-- Select Related To --</option>

                                {relatedToIssues.map((i) => (

                                  <option key={i.key} value={i.key}>{i.key} - {i.summary}</option>

                                ))}

                              </select>

                            )}

                          </div>



                          <div className="jiraOption">

                            <label>Sprint</label>

                            <input

                              type="text"

                              className="searchInput"

                              placeholder="Search sprint..."

                              value={sprintSearch}

                              onChange={(e) => handleSprintSearchChange(e.target.value)}

                              onFocus={handleSprintSearchFocus}

                              disabled={jiraLoading}

                            />

                            {showSprintList && (

                              <select

                                value={selectedSprint}

                                onChange={(e) => handleSelectSprint(e.target.value)}

                                disabled={jiraLoading}

                                size={5}

                                className="searchableSelect"

                              >

                                <option value="">-- Select Sprint --</option>

                                {jiraSprints.map((s) => (

                                  <option key={String(s.id)} value={String(s.id)}>{s.name}</option>

                                ))}

                              </select>

                            )}

                          </div>



                          <div className="jiraOption">

                            <label>Priority</label>

                            <select

                              className="editSelect"

                              value={selectedJiraPriority}

                              onChange={(e) => setSelectedJiraPriority(e.target.value)}

                              disabled={jiraLoading}

                            >

                              {jiraPriorities

                                .filter((p) => {

                                  const name = (p.name || "").toLowerCase().trim();

                                  return name && name !== "no priority" && !name.includes("select");

                                })

                                .map((p) => (

                                  <option key={p.id} value={p.name}>

                                    {p.name}

                                  </option>

                                ))}

                            </select>

                          </div>



                          <div className="jiraOption fullWidth">

                            <label>Comment</label>

                            <AutoResizeCommentTextarea value={jiraComment} onChange={setJiraComment} disabled={jiraLoading} />

                          </div>

                        </div>



                        <div className="jiraButtonRow">

                          <span className={jiraLoading || jiraMissingFields.length > 0 ? "zephyrTooltipWrap" : undefined}>

                            <button

                              className="jiraButton"

                              onClick={handleUploadToJira}

                              disabled={jiraLoading || jiraMissingFields.length > 0}

                            >

                              {jiraLoading ? "Creating..." : "Create JIRA Bug"}

                            </button>

                            {(jiraLoading || jiraMissingFields.length > 0) && jiraCreateTooltip && (

                              <span className="zephyrTooltip" role="tooltip">

                                {jiraCreateTooltip}

                              </span>

                            )}

                          </span>

                        </div>

                      </div>

                    )}



                    {jiraResult && (

                      <div className="jiraSuccess">

                        <div className="jiraSuccessTitle">✓ JIRA Bug Created</div>

                        <a href={jiraResult.url} target="_blank" rel="noreferrer">

                          {jiraResult.key} - Open in Jira

                        </a>

                      </div>

                    )}

                  </>

                ) : (

                  renderReport(msg.report, false)

                )

              ) : null}

            </div>

          ))}

          {isLoading && (

            <div className="loadingState">

              {streamingText ? (

                <div className="streamingContent">

                  <div className="streamingHeader">

                    <span className="typingDots">

                      <span></span><span></span><span></span>

                    </span>

                    <span>Generating bug report...</span>

                  </div>

                  <div

                    className="streamingText"

                    ref={streamingTextRef}

                    onScroll={(e) => {

                      const el = e.currentTarget;

                      const threshold = 24;

                      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;

                      streamingAutoScrollRef.current = atBottom;

                    }}

                  >

                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>

                  </div>

                </div>

              ) : (

                <>

                  <div className="loadingSpinner"></div>

                  <div className="loadingText">Connecting to AI...</div>

                </>

              )}

            </div>

          )}

          <div ref={bottomAnchorRef} />

        </div>



        {error && <div className="error">{error}</div>}

      </div>



      {activeTab === "ai" && (

        <div className="inputArea">

          {imagePreviews.length > 0 && (

            <div className="imagePreviewsContainer">

              {imagePreviews.map((src, idx) => (

                <div key={idx} className="imagePreviewItem">

                  {src.startsWith("video:") ? (

                    <div className="videoPreviewThumb">

                      <span className="videoIcon">🎬</span>

                      <span className="videoName">{src.replace("video:", "")}</span>

                    </div>

                  ) : (

                    <img src={src} alt={`Preview ${idx + 1}`} className="imagePreviewThumb" />

                  )}

                  <button

                    type="button"

                    className="imagePreviewRemove"

                    onClick={() => removeFile(idx)}

                    disabled={isLoading}

                  >

                    ✕

                  </button>

                </div>

              ))}

            </div>

          )}

          <div className="inputWrapper">

            <div className="textareaResizeHandle" onPointerDown={startTextareaResize} />

            <textarea

              className="textarea"

              placeholder="Describe the bug..."

              ref={inputTextareaRef}

              value={input}

              onChange={(e) => setInput(e.target.value)}

              onPaste={handlePaste}

              style={{ height: `${inputHeight}px` }}

              onKeyDown={(e) => {

                if (e.key === "Enter" && !e.shiftKey) {

                  e.preventDefault();

                  if (!isLoading) handleSubmit();

                }

              }}

              disabled={isLoading}

            />

            <div className="inputActions">

              <button

                type="button"

                className={`attachButton ${files.length > 0 ? "hasFile" : ""}`}

                disabled={isLoading}

                onClick={() => fileInputRef.current?.click()}

              >

                📎 Attach

              </button>

              <button

                type="button"

                className="sendButton"

                onClick={handleSubmit}

                disabled={isLoading || input.trim().length < 3}

              >

                {isLoading ? (

                  <span className="sendButtonDots" aria-hidden="true">

                    <span className="sendButtonDot" />

                    <span className="sendButtonDot" />

                  </span>

                ) : (

                  "➤"

                )}

              </button>

            </div>

            <input

              ref={fileInputRef}

              type="file"

              accept="image/*,video/*"

              multiple

              style={{ display: "none" }}

              onChange={(e) => {

                if (e.target.files) addFiles(e.target.files);

                e.target.value = "";

              }}

            />

          </div>

          <div className="hint">Press Enter to send · Shift+Enter for new line · Ctrl+V to paste image</div>

        </div>

      )}



      <footer className="globalFooter">

        <span className="footerBrand">

          <span>BugGenAI – Developed by</span>

          <a className="footerLogoLink" href="https://www.siliconexpert.com/" target="_blank" rel="noreferrer noopener" aria-label="Open SiliconExpert">

            <svg className="footerLogo" width="158" height="42" viewBox="0 0 158 42" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">

              <rect width="158" height="42" fill="none" />

              <g clipPath="url(#clip0_1_42)">

              <path d="M39.6887 17.0262C39.0735 16.2436 38.4348 15.8859 36.8636 15.8859C35.5196 15.8859 34.6536 16.3994 34.6536 17.3839C34.6536 18.6588 35.7939 19.0395 37.2965 19.151C39.4379 19.3068 41.3971 19.9106 41.3971 22.4834C41.3971 24.4294 40.0531 25.7697 37.1143 25.7697C34.7908 25.7697 33.582 25.0774 32.718 23.9141L34.062 22.9757C34.6771 23.7795 35.498 24.116 37.1378 24.116C38.664 24.116 39.575 23.5333 39.575 22.5277C39.575 21.3201 38.8462 20.8951 36.6363 20.7374C34.7222 20.6028 32.8316 19.8433 32.8316 17.405C32.8316 15.5494 34.1991 14.2284 36.9106 14.2284C38.7561 14.2284 40.1687 14.6976 41.0581 16.084L39.6906 17.0243L39.6887 17.0262Z" fill="white" />

              <path d="M43.558 10.1614H45.6093V12.1747H43.558V10.1614ZM43.6717 14.4091H45.4956V25.5909H43.6717V14.4091Z" fill="white" />

              <path d="M48.2287 10.1614H50.0527V21.7008C50.0527 22.9084 50.1212 23.9372 51.9883 23.9372V25.5909C49.1181 25.5909 48.2287 24.4736 48.2287 22.1469V10.1614Z" fill="white" />

              <path d="M54.1277 10.1614H56.179V12.1747H54.1277V10.1614ZM54.2414 14.4091H56.0634V25.5909H54.2414V14.4091Z" fill="white" />

              <path d="M67.0915 23.891C66.3843 25.1871 64.9952 25.7678 63.1497 25.7678C60.0287 25.7678 58.2283 23.8006 58.2283 20.7144V19.2376C58.2283 16.0628 60.0738 14.2284 63.1497 14.2284C64.8581 14.2284 66.2706 14.8322 67.0915 15.9725L65.6555 16.9551C65.1539 16.2398 64.1978 15.8379 63.1497 15.8379C61.1905 15.8379 60.0503 17.1339 60.0503 19.2376V20.7144C60.0503 22.6373 60.9613 24.1583 63.1497 24.1583C64.2213 24.1583 65.2009 23.8006 65.679 22.9046L67.0915 23.8891V23.891Z" fill="white" />

              <path d="M77.2498 20.7163C77.2498 23.6237 75.7922 25.7697 72.5106 25.7697C69.4797 25.7697 67.7713 23.8026 67.7713 20.7163V19.2395C67.7713 16.0648 69.5248 14.2303 72.5106 14.2303C75.4963 14.2303 77.2498 16.0417 77.2498 19.2395V20.7163ZM75.4278 20.7163V19.2395C75.4278 17.1147 74.3796 15.8398 72.5106 15.8398C70.6415 15.8398 69.5934 17.1358 69.5934 19.2395V20.7163C69.5934 22.6392 70.4123 24.1602 72.5106 24.1602C74.4462 24.1602 75.4278 22.618 75.4278 20.7163Z" fill="white" />

              <path d="M79.0699 14.4091H80.8919V15.5052C81.462 14.6553 82.2594 14.2303 83.9443 14.2303C86.3815 14.2303 88.0918 15.4841 88.0918 18.6145V25.5909H86.2698V18.6357C86.2698 16.3782 85.0159 15.8859 83.6719 15.8859C81.9635 15.8859 80.8919 17.0705 80.8919 18.6145V25.5909H79.0699V14.4091Z" fill="white" />

              <path d="M98.9809 23.891C98.1835 25.2543 96.861 25.7908 94.8117 25.7908C91.395 25.7908 89.7532 23.6218 89.7532 20.7374V19.2164C89.7532 15.8398 91.4851 14.2072 94.4473 14.2072C97.6604 14.2072 99.1415 16.0417 99.1415 19.4395V20.7144H92.6488C92.6723 22.2565 93.1739 23.3757 94.7902 23.3757C95.997 23.3757 96.385 23.018 96.8179 22.4142L98.9828 23.891H98.9809ZM92.6469 18.6799H96.2243C96.1557 17.2262 95.5641 16.6224 94.4709 16.6224C93.3091 16.6224 92.7625 17.405 92.6469 18.6799Z" fill="white" />

              <path d="M106.704 25.5909L104.494 22.1912L102.284 25.5909H99.071L102.807 19.8664L99.3668 14.4091H102.58L104.494 17.6069L106.408 14.4091H109.621L106.181 19.8664L109.94 25.5909H106.704Z" fill="white" />

              <path d="M120.532 20.7374C120.532 23.6449 119.027 25.7908 116.088 25.7908C114.903 25.7908 114.106 25.5678 113.583 25.1428V29.8386H110.665V14.4091H113.583V15.1475C114.129 14.5437 114.95 14.2092 116.112 14.2092C118.755 14.2092 120.532 16.0205 120.532 19.2183V20.7394V20.7374ZM117.614 20.5586V19.3952C117.614 17.6069 117.044 16.6224 115.608 16.6224C114.172 16.6224 113.581 17.5166 113.581 19.1491V20.5586C113.581 22.1681 113.968 23.3757 115.608 23.3757C117.248 23.3757 117.614 22.1681 117.614 20.5586Z" fill="white" />

              <path d="M130.69 23.891C129.893 25.2543 128.57 25.7908 126.521 25.7908C123.104 25.7908 121.462 23.6218 121.462 20.7374V19.2164C121.462 15.8398 123.194 14.2072 126.156 14.2072C129.369 14.2072 130.851 16.0417 130.851 19.4395V20.7144H124.358C124.381 22.2565 124.881 23.3757 126.499 23.3757C127.706 23.3757 128.094 23.018 128.527 22.4142L130.692 23.891H130.69ZM124.356 18.6799H127.933C127.865 17.2262 127.273 16.6224 126.18 16.6224C125.018 16.6224 124.472 17.405 124.358 18.6799H124.356Z" fill="white" />

              <path d="M138.548 17.5185C138.252 17.0935 137.843 16.6686 137.112 16.6686C136.019 16.6686 135.29 17.4512 135.29 19.0164V25.5909H132.373V14.4091H135.221V15.3494C135.609 14.7899 136.362 14.2092 137.704 14.2092C139.046 14.2092 140.096 14.7899 140.78 15.9532L138.546 17.5185H138.548Z" fill="white" />

              <path d="M141.328 14.4091H141.332V10.8845H144.226V14.4091H147.002V16.8243H144.226V21.497C144.226 22.6161 144.996 23.0853 146.067 23.0853H147.002V25.5909H145.772C143.015 25.5909 141.332 24.8313 141.332 21.9469V16.8262H141.328V14.4111V14.4091Z" fill="white" />

              <path d="M17.2562 12.6864C17.2171 13.5113 16.5764 14.5035 15.8319 14.8919L8.28131 18.8301C7.53879 19.2185 6.96084 18.8589 7.00198 18.034L7.13324 15.2996C7.17243 14.4747 7.81307 13.4825 8.55756 13.094L16.1062 9.15591C16.8487 8.76748 17.4267 9.12707 17.3856 9.952L17.2543 12.6864H17.2562Z" fill="white" />

              <path d="M26.8032 24.7025C26.7641 25.5274 26.1234 26.5196 25.3789 26.908L17.8283 30.8442C17.0858 31.2327 16.5078 30.8731 16.549 30.0482L16.6802 27.3138C16.7194 26.4889 17.3601 25.4966 18.1045 25.1082L25.6552 21.172C26.3977 20.7836 26.9756 21.1432 26.9345 21.9681L26.8032 24.7025Z" fill="white" />

              <path d="M26.7308 16.3859C26.6916 17.2108 26.049 18.2011 25.3045 18.5857L8.41452 27.2869C7.67003 27.6714 7.09208 27.3099 7.13126 26.485L7.26253 23.7506C7.30171 22.9257 7.94432 21.9354 8.6888 21.5508L25.5788 12.8477C26.3232 12.4632 26.9012 12.8247 26.862 13.6496L26.7308 16.384V16.3859Z" fill="#FCC937" />

            </g>

            <defs>

              <clipPath id="clip0_1_42">

                <rect width="140" height="22" transform="translate(7 9)" />

              </clipPath>

            </defs>

            </svg>

          </a>

        </span>

      </footer>

    </div>

  );

}

