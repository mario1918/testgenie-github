# BugGenAI

BugGenAI is a monorepo that provides:

- A single **AI Bug Generator** UI (React + Vite)
- A **Failed Test Cases (Zephyr/Jira)** UI embedded in the same frontend
- A single **Node/Express backend** that serves:
  - AI generation endpoints
  - Jira + Zephyr (Squad) API endpoints

This repo was recently enhanced to run everything with **one frontend port** and **one backend process/port**.

---

## Architecture (Current)

- **Frontend**: apps/ai-frontend (Vite)
  - Dev URL: http://localhost:5173
  - Includes:
    - **Failed Test Cases** tab (ZephyrPanel)
    - **Bug AI Generator** tab

- **Backend**: apps/ai-backend (Express)
  - Default URL: http://localhost:4000
  - Hosts both:
    - AI endpoints
    - Jira/Zephyr endpoints (merged from the former jira-zephyr backend)

---

## Dev Proxies (Vite)

During development, the frontend proxies requests to the backend:

- GET/POST /ai-api/* → AI backend (path rewritten to backend)
- GET/POST /jira-zephyr-api/* → same backend (path rewritten to backend)
- GET/POST /api/* → same backend (compatibility for Zephyr routes)

This allows the frontend to run on a single port while calling a single backend.

---

## Quick Start

### 1) Install dependencies

From repo root (BugGenAI/):

- Install root dependencies
- Ensure backend/frontend dependencies are installed (via workspace scripts)

If you already have 
node_modules, you can skip.

### 2) Configure environment

Copy .env.example to .env in the repo root and fill values.

At minimum for Zephyr/Jira features you need:

- JIRA_BASE_URL
- JIRA_EMAIL
- JIRA_API_TOKEN
- JIRA_PROJECT_KEY

For AI generation you need the AI-related variables described in .env.example.

### 3) Run

On Windows, run:

- start.bat

This starts:

- BugGenAI - AI Backend
- BugGenAI - AI Frontend

---

## Ports

Defaults:

- Frontend: 5173
- Backend: 4000

---

## start.bat behavior (Port conflict handling)

start.bat checks if backend port 4000 is already in use.

If it is, it prompts to kill the PID (or abort), then starts backend + frontend.

---

## ZephyrPanel (Failed Test Cases) UX

Recent UI enhancements:

- **Pagination controls** use icons (First/Prev/Next/Last).
- **View** action uses an eye icon.
- **Test Details** popup:
  - Movable (drag by header)
  - Closes when clicking outside
- **Skeleton loaders** for task loading and steps loading.

### Generate Bug workflow

- In **Test Details**, click **Generate Bug**.
- The app sends only the following to the AI tab:

`	ext
Input Data:
- Test Case Summary: <summary>
- Test Case Steps:
<steps>
`

---

## AI Streaming UX

During generation:

- The streaming output (.streamingText) auto-scrolls to keep the latest chunk visible.
- When generation completes, the UI scrolls to the start of the latest editable report and focuses the Title field.

---

## Editing / Deleting optional report fields

In the editable report UI:

- The ✕ button on optional fields **deletes/hides** the field section.
- You can re-add deleted fields using the + Add <Field> buttons.

Backend Jira payload creation trims/filters empty values, so deleted/empty fields are omitted from the Jira description.

---

## Troubleshooting

### EADDRINUSE on backend port 4000

- A previous backend process is still running.
- Re-run start.bat and choose to kill the PID, or close the old terminal.

### Vite proxy ECONNRESET

This usually means the backend closed the connection (crash/restart) or the proxy target was wrong.

- Confirm backend is running
- Check backend console output for errors
- Ensure frontend proxies /api, /ai-api, /jira-zephyr-api all point to the same backend

---

## Repo layout

- pps/ai-frontend – React/Vite frontend
- pps/ai-backend – Express backend (AI + Jira/Zephyr merged)
- pps/jira-zephyr – legacy codebase (no longer required to run as a separate server)
