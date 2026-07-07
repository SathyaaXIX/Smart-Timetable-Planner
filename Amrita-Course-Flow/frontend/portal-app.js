import { options, roleNav } from "./config.js";

const app = document.querySelector("#app");

const state = {
  user: null,
  page: window.location.pathname,
  edit: {},
  timetableResult: null,
  timetablePublishedOption: null,
  timetableOption: "A",
  flash: null,
  realtimeTimer: null,
  adminAlertCount: 0
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, init = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data && data.error ? data.error : "Request failed");
  }
  return data;
}

function go(path) {
  history.pushState({}, "", path);
  state.page = path;
  render();
}

function todayLocalDate() {
  const nowDate = new Date();
  const year = nowDate.getFullYear();
  const month = String(nowDate.getMonth() + 1).padStart(2, "0");
  const day = String(nowDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setHtml(html) {
  app.innerHTML = html;
}

function badge(value) {
  const label = value === true ? "Open" : value === false ? "Closed" : String(value);
  const off = ["Inactive", "Maintenance", "dropped", false, "Pending"].includes(value) || label === "Pending";
  const variants = {
    Present: "state-present",
    Absent: "state-absent",
    "Not Marked": "state-unmarked",
    Replaced: "state-replaced",
    Free: "state-free",
    "Replacement Session": "state-replaced",
    Pending: "state-pending",
    Resolved: "state-resolved"
  };
  const variant = variants[label] || "";
  return `<span class="badge ${off ? "off" : ""} ${variant}">${escapeHtml(label)}</span>`;
}

function setFlash(message, type = "success", scope = null) {
  state.flash = {
    message: String(message || "").trim(),
    type,
    scope,
    createdAt: Date.now()
  };
}

function flashHtml(scope = null) {
  if (!state.flash || !state.flash.message) return "";
  if (scope && state.flash.scope && state.flash.scope !== scope) return "";
  if (Date.now() - Number(state.flash.createdAt || 0) > 15000) {
    state.flash = null;
    return "";
  }
  const level = state.flash.type === "error" ? "error" : "";
  return `<section class="notice ${level}" style="margin-top:16px">${escapeHtml(state.flash.message)}</section>`;
}

function syncRealtimeRefresh() {
  const livePages = new Set(["/admin/faculty-alerts", "/admin/dashboard"]);
  const shouldPoll = Boolean(state.user && livePages.has(state.page));
  if (!shouldPoll && state.realtimeTimer) {
    clearInterval(state.realtimeTimer);
    state.realtimeTimer = null;
    return;
  }
  if (shouldPoll && !state.realtimeTimer) {
    state.realtimeTimer = setInterval(() => {
      if (document.visibilityState === "visible") render();
    }, 5000);
  }
}

function button(label, path, extra = "") {
  return `<button class="btn ${extra}" type="button" data-route="${path}">${label}</button>`;
}

function home() {
  setHtml(`
    <div class="home-shell">
      <div class="top-strip"></div>
      <main class="home-main">
        <img class="logo" src="/logo.png" alt="Amrita Vishwa Vidyapeetham">
        <h1 class="brand-title">Amrita Vishwa Vidyapeetham</h1>
        <p class="brand-subtitle">Smart Course Registration & Timetable Planner</p>
        <section class="role-grid">
          ${roleCard("S", "Student", "Register for courses, view enrolled subjects, manage your timetable and track credits.", "/student/login")}
          ${roleCard("F", "Faculty", "View assigned courses, monitor registrations and check your teaching timetable.", "/faculty/login")}
          ${roleCard("A", "Administrator", "Manage courses, students, faculty, rooms, groups and published timetables.", "/admin/login")}
        </section>
        <p class="muted" style="margin-top:34px">Demo logins: admin/admin123, AIDFAC001/faculty123 (also supports FAC001/faculty123), AID1NA01/student123 (legacy CB.EN.U4CSE23001 also supported)</p>
      </main>
    </div>
  `);
}

function roleCard(icon, title, text, path) {
  return `
    <article class="role-card">
      <div class="role-icon">${icon}</div>
      <h2>${title}</h2>
      <p>${text}</p>
      ${button(`${title} Login`, path)}
    </article>
  `;
}

function login(role) {
  const title = role.charAt(0).toUpperCase() + role.slice(1);
  const usernameLabel = role === "faculty" ? "Faculty ID" : role === "student" ? "Roll Number" : "Username";
  setHtml(`
    <main class="login-page">
      <section class="login-card">
        <img class="logo" src="/logo.png" alt="Amrita Vishwa Vidyapeetham">
        <h1>${title} Login</h1>
        <p class="muted">Sign in to continue to your ${title.toLowerCase()} workspace.</p>
        <form id="login-form">
          <div class="field">
            <label>${usernameLabel}</label>
            <input name="username" autocomplete="username" required>
          </div>
          <div class="field">
            <label>Password</label>
            <input name="password" type="password" autocomplete="current-password" required>
          </div>
          <div id="login-error"></div>
          <button class="btn" type="submit">Login</button>
          <button class="btn secondary" type="button" data-route="/">Back</button>
        </form>
      </section>
    </main>
  `);

  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
          role
        })
      });
      state.user = result.user;
      go(`/${result.user.role}/dashboard`);
    } catch (error) {
      document.querySelector("#login-error").innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
    }
  });
}

function shell(title, subtitle, content) {
  const nav = roleNav[state.user.role]
    .map(([label, path]) => {
      const isAlertNav = state.user.role === "admin" && path === "/admin/faculty-alerts";
      const count = isAlertNav ? Number(state.adminAlertCount || 0) : 0;
      const countHtml = count > 0 ? `<span class="nav-alert-count">${count > 99 ? "99+" : count}</span>` : "";
      return `<button class="${state.page === path ? "active" : ""}" data-route="${path}">${label}${countHtml}</button>`;
    })
    .join("");

  setHtml(`
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <img src="/logo.png" alt="Amrita">
          <div>
            <h2 class="sidebar-title">Amrita Course Flow</h2>
            <small>${escapeHtml(state.user.name)}</small>
          </div>
        </div>
        <nav class="nav">${nav}</nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <h1>${title}</h1>
            <p class="muted">${subtitle}</p>
          </div>
          <button class="btn secondary" id="logout">Logout</button>
        </header>
        ${content}
      </main>
    </div>
  `);

  document.querySelector("#logout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    state.user = null;
    go("/");
  });
}

function metrics(items) {
  return `<section class="grid metrics">${items.map(([label, value]) => `<article class="metric"><span class="muted">${label}</span><strong>${value}</strong></article>`).join("")}</section>`;
}

function table(headers, rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
        <tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="muted">No records yet</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function detailsBlock(summary, content, open = false) {
  return `<details ${open ? "open" : ""}><summary>${summary}</summary>${content}</details>`;
}

function parseGroupSectionName(sectionNameRaw) {
  const raw = String(sectionNameRaw || "").trim();
  if (!raw) return { streamName: "", sectionCode: "" };
  const parts = raw.split("-").map((item) => String(item || "").trim()).filter(Boolean);
  if (parts.length >= 2) return { streamName: parts[0], sectionCode: parts.slice(1).join("-") };
  if (raw === "Medical" || raw === "Non-Medical") return { streamName: raw, sectionCode: "A" };
  return { streamName: "", sectionCode: raw };
}

function buildGroupSectionName(streamNameRaw, sectionCodeRaw, fallbackSectionNameRaw = "") {
  const streamName = String(streamNameRaw || "").trim();
  const sectionCode = String(sectionCodeRaw || "").trim().toUpperCase();
  if (streamName && sectionCode) return `${streamName}-${sectionCode}`;
  return String(fallbackSectionNameRaw || "").trim();
}

function normalizeDepartmentKey(value) {
  return String(value || "").trim().toUpperCase().replace(/&/g, "AND").replace(/\s+/g, "");
}

function yearOrdinalFromName(yearNameValue) {
  const yearName = String(yearNameValue || "").trim();
  const match = yearName.match(/([1-4])\s*(?:st|nd|rd|th)?/i);
  return match ? Number(match[1]) : 0;
}

function isMtechYearName(yearNameValue) {
  return /m[\s-]*tech/i.test(String(yearNameValue || ""));
}

function normalizeProgramName(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (raw === "m.tech" || raw === "mtech") return "M.Tech";
  return "B.Tech";
}

function normalizeProgramFilter(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return normalizeProgramName(raw);
}

function stripProgramPrefix(groupName) {
  return String(groupName || "").trim().replace(/^(?:B\.?\s*Tech|M\.?\s*Tech)\s+/i, "");
}

function parseGroupNameFallback(groupNameRaw) {
  const raw = String(groupNameRaw || "").trim();
  if (!raw) return { yearName: "", sectionName: "" };
  const noProgram = stripProgramPrefix(raw);
  const yearMatch = noProgram.match(/([1-4](?:st|nd|rd|th)\s+Year)/i);
  const yearName = yearMatch ? yearMatch[1] : "";
  const middle = yearName ? noProgram.replace(yearMatch[0], "").trim() : noProgram;
  const secMatch = middle.match(/-\s*(.*?)\s*\(/);
  const sectionName = secMatch ? secMatch[1].trim() : "";
  return { yearName, sectionName };
}

function yearOptionsByProgram(program) {
  return normalizeProgramName(program) === "M.Tech"
    ? ["1st Year", "2nd Year"]
    : ["1st Year", "2nd Year", "3rd Year", "4th Year"];
}

function semesterToYearName(semesterValue) {
  const semester = Number(semesterValue || 0);
  if (!Number.isFinite(semester) || semester <= 0) return "";
  if (semester <= 2) return "1st Year";
  if (semester <= 4) return "2nd Year";
  if (semester <= 6) return "3rd Year";
  return "4th Year";
}

function semesterToYearNameForTrack(semesterValue, currentYearName) {
  const baseYear = semesterToYearName(semesterValue);
  if (!baseYear) return "";
  return baseYear;
}

function fallbackSemesterFromYear(yearName) {
  const yearNo = yearOrdinalFromName(yearName);
  if (isMtechYearName(yearName)) {
    if (yearNo === 1) return "1";
    if (yearNo === 2) return "3";
    return "";
  }
  if (yearNo === 1) return "1";
  if (yearNo === 2) return "3";
  if (yearNo === 3) return "5";
  if (yearNo === 4) return "7";
  return "";
}

function semesterOptionsByYearName(yearName) {
  const yearNo = yearOrdinalFromName(yearName);
  if (isMtechYearName(yearName)) {
    if (yearNo === 1) return ["1", "2"];
    if (yearNo === 2) return ["3", "4"];
    return ["1", "2", "3", "4"];
  }
  if (yearNo === 1) return ["1", "2"];
  if (yearNo === 2) return ["3", "4"];
  if (yearNo === 3) return ["5", "6"];
  if (yearNo === 4) return ["7", "8"];
  return options.semester;
}

function groupSemesterValue(group) {
  return String((group && group.semester) || "").trim() || fallbackSemesterFromYear(group ? group.yearName : "");
}

function studentHierarchyHtml(rows, groups, nav = {}) {
  const groupById = new Map((groups || []).map((group) => [Number(group.id), group]));
  const normalizedRows = rows.map((row) => {
    const group = groupById.get(Number(row.groupId));
    return {
      ...row,
      degree: "B.Tech",
      department: row.department || (group && group.department) || "Unassigned Department",
      year: (group && group.yearName) || "Unassigned Year",
      section: (group && group.sectionName) || "Unassigned Section",
      groupLabel: group ? group.label : (row.groupName || "Unassigned")
    };
  });
  if (!normalizedRows.length) return `<section class="panel"><p class="muted">No students found.</p></section>`;

  const level = nav.level || "degree";
  const degree = nav.degree || "";
  const department = nav.department || "";
  const year = nav.year || "";
  const section = nav.section || "";
  const backTarget = level === "degree" ? "" : `<button class="btn secondary" data-student-nav-back="1">Back</button>`;
  const header = `<div class="crud-toolbar"><strong>Student Navigator</strong>${backTarget}</div>`;

  if (level === "degree") {
    const degreeMap = groupBy(normalizedRows, (row) => row.degree);
    const cards = Array.from(degreeMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => `
      <button class="hierarchy-card" data-student-nav-level="department" data-student-nav-value="${escapeHtml(name)}">
        <strong>${escapeHtml(name)}</strong><span>${list.length} students</span>
      </button>
    `).join("");
    return `<section class="panel">${header}<h2>Degree</h2><div class="hierarchy-grid">${cards}</div></section>`;
  }

  const degreeRows = normalizedRows.filter((row) => row.degree === degree);

  if (level === "department") {
    const deptMap = groupBy(degreeRows, (row) => row.department);
    const cards = Array.from(deptMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => `
      <button class="hierarchy-card" data-student-nav-level="year" data-student-nav-value="${escapeHtml(name)}">
        <strong>${escapeHtml(name)}</strong><span>${list.length} students</span>
      </button>
    `).join("");
    return `<section class="panel">${header}<h2>Departments</h2><div class="hierarchy-grid">${cards}</div></section>`;
  }

  const deptRows = degreeRows.filter((row) => row.department === department);
  if (level === "year") {
    const yearMap = groupBy(deptRows, (row) => row.year);
    const cards = Array.from(yearMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => `
      <button class="hierarchy-card" data-student-nav-level="section" data-student-nav-value="${escapeHtml(name)}">
        <strong>${escapeHtml(name)}</strong><span>${list.length} students</span>
      </button>
    `).join("");
    return `<section class="panel">${header}<h2>${escapeHtml(degree)} -> ${escapeHtml(department)}</h2><h3>Years</h3><div class="hierarchy-grid">${cards || `<p class="muted">No years found.</p>`}</div></section>`;
  }

  const yearRows = deptRows.filter((row) => row.year === year);
  if (level === "section") {
    const groupMap = groupBy(yearRows, (row) => row.section);
    const cards = Array.from(groupMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => `
      <button class="hierarchy-card" data-student-nav-level="students" data-student-nav-value="${escapeHtml(name)}">
        <strong>${escapeHtml(name)}</strong><span>${list.length} students</span>
      </button>
    `).join("");
    return `<section class="panel">${header}<h2>${escapeHtml(degree)} -> ${escapeHtml(department)} -> ${escapeHtml(year)}</h2><h3>Sections</h3><div class="hierarchy-grid">${cards || `<p class="muted">No sections found.</p>`}</div></section>`;
  }

  const studentsRows = yearRows.filter((row) => row.section === section).sort((a, b) => String(a.rollNumber || "").localeCompare(String(b.rollNumber || "")));
  return `<section class="panel">
    ${header}
    <h2>${escapeHtml(degree)} -> ${escapeHtml(department)} -> ${escapeHtml(year)} -> ${escapeHtml(section)}</h2>
    ${table(
      ["Student", "Roll Number", "Class", "Status", "Actions"],
      studentsRows.map((student) => `
        <tr>
          <td><strong>${escapeHtml(student.studentName)}</strong><br><span class="muted">${escapeHtml(student.email || "-")}</span></td>
          <td>${escapeHtml(student.rollNumber)}</td>
          <td>${escapeHtml(student.groupLabel)}</td>
          <td>${badge(student.status)}</td>
          <td class="actions">${editDelete("students", student.id, "/api/admin/student-records", student)}</td>
        </tr>
      `)
    )}
  </section>`;
}

function facultyNavigatorHtml(facultyRows, bootstrap, nav = {}) {
  const courseByCode = new Map((bootstrap.courses || []).map((course) => [String(course.code || "").toUpperCase(), course]));
  const mappingsByFaculty = new Map();
  for (const mapping of bootstrap.facultyCourseMappings || []) {
    if (!mappingsByFaculty.has(mapping.facultyId)) mappingsByFaculty.set(mapping.facultyId, []);
    mappingsByFaculty.get(mapping.facultyId).push(mapping);
  }
  const level = nav.level || "department";
  const department = nav.department || "";
  const expertise = nav.expertise || "";
  const backTarget = level === "department" ? "" : `<button class="btn secondary" data-faculty-nav-back="1">Back</button>`;
  const header = `<div class="crud-toolbar"><strong>Faculty Navigator</strong>${backTarget}</div>`;

  const departmentMap = groupBy(facultyRows, (row) => row.department || "Unassigned Department");
  const departments = Array.from(departmentMap.keys()).sort((a, b) => a.localeCompare(b));
  if (!departments.length) return `<section class="panel"><p class="muted">No faculty records found.</p></section>`;

  if (level === "department") {
    const cards = departments.map((name) => {
      const count = (departmentMap.get(name) || []).length;
      return `<button class="hierarchy-card" data-faculty-nav-level="expertise" data-faculty-nav-value="${escapeHtml(name)}">
        <strong>${escapeHtml(name)}</strong><span>${count} faculty</span>
      </button>`;
    }).join("");
    return `<section class="panel">${header}<h2>Departments</h2><div class="hierarchy-grid">${cards}</div></section>`;
  }

  const deptRows = departmentMap.get(department) || [];
  const expertiseMap = new Map();
  for (const row of deptRows) {
    const mappings = mappingsByFaculty.get(row.id) || [];
    const expertiseList = mappings
      .map((mapping) => {
        const code = String(mapping.courseCode || "").toUpperCase();
        const course = courseByCode.get(code);
        return course ? `${course.code} - ${course.name}` : code;
      });
    if (!expertiseList.length) expertiseList.push("General");
    for (const item of expertiseList) {
      if (!expertiseMap.has(item)) expertiseMap.set(item, []);
      expertiseMap.get(item).push(row);
    }
  }

  if (level === "expertise") {
    const cards = Array.from(expertiseMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => `
      <button class="hierarchy-card" data-faculty-nav-level="faculty" data-faculty-nav-value="${escapeHtml(name)}">
        <strong>${escapeHtml(name)}</strong><span>${list.length} faculty</span>
      </button>
    `).join("");
    return `<section class="panel">${header}<h2>Department: ${escapeHtml(department)}</h2><h3>Subject Expertise</h3><div class="hierarchy-grid">${cards || `<p class="muted">No expertise mapped.</p>`}</div></section>`;
  }

  const list = (expertiseMap.get(expertise) || []).sort((a, b) => String(a.facultyName || "").localeCompare(String(b.facultyName || "")));
  return `<section class="panel">
    ${header}
    <h2>${escapeHtml(department)} -> ${escapeHtml(expertise)}</h2>
    ${table(
      ["Faculty", "Faculty ID", "Email", "Department", "Subject Expertise", "Workload", "Status", "Actions"],
      list.map((faculty) => `
        <tr>
          <td><strong>${escapeHtml(faculty.facultyName)}</strong></td>
          <td>${escapeHtml(faculty.facultyId)}</td>
          <td>${escapeHtml(faculty.email || "-")}</td>
          <td>${escapeHtml(faculty.department || "-")}</td>
          <td>${escapeHtml((faculty.teachableCourseCodes || []).join(", ") || "-")}</td>
          <td>${escapeHtml(`${faculty.workload || 0} / ${faculty.maxWorkload || 0}`)}</td>
          <td>${badge(faculty.status)}</td>
          <td class="actions">${editDelete("faculty", faculty.id, "/api/faculty-records", faculty)}</td>
        </tr>
      `)
    )}
  </section>`;
}

async function adminStudentsPage() {
  const bootstrap = await api("/api/bootstrap");
  const departments = (bootstrap.departments || []).filter((row) => row.status !== "Inactive");
  const hasDepartments = departments.length > 0;
  const selectedView = state.edit.adminStudentView || "view";
  const selectedDept = state.edit.adminStudentDept || "";
  const selectedYear = state.edit.adminStudentYear || "";
  const selectedSection = state.edit.adminStudentSection || "";
  const canSearch = Boolean(selectedDept && selectedYear && selectedSection);
  const rows = canSearch
    ? await api(`/api/admin/student-records?department=${encodeURIComponent(selectedDept)}&yearName=${encodeURIComponent(selectedYear)}&sectionName=${encodeURIComponent(selectedSection)}`)
    : [];
  const config = crudConfig("students");
  const editing = state.edit[config.key] || {};
  const showForm = selectedView === "add" || Boolean(editing.id || editing.__create);
  const enrichedFields = config.fields.map((field) => {
    if (field.name === "department") {
      return { ...field, options: departments.map((item) => [item.departmentName, item.departmentName]) };
    }
    if (field.name === "sectionName") {
      const availableSections = Array.from(new Set((bootstrap.groups || []).filter((group) => !editing.department || group.department === editing.department).map((group) => group.sectionName))).filter(Boolean);
      const sectionOptions = availableSections.length ? availableSections : options.sectionName;
      return { ...field, options: sectionOptions };
    }
    return field;
  });
  shell(
    config.title,
    "Add students with Department/Year/Section, and view students only via filters.",
    `
      ${flashHtml("students")}
      ${hasDepartments ? "" : `<section class="notice error">No active department found. Create a branch in Departments first.<div style="margin-top:10px">${button("Go to Departments", "/admin/departments", "secondary")}</div></section>`}
      <section class="crud-toolbar">
        <button class="btn ${selectedView === "add" ? "" : "secondary"}" data-student-view="add" ${hasDepartments ? "" : "disabled"}>Add Student</button>
        <button class="btn ${selectedView === "view" ? "" : "secondary"}" data-student-view="view">View Students</button>
      </section>
      ${selectedView === "view" ? `<section class="form-panel">
        <h2>Filter Students</h2>
        <form id="student-filter-form" class="form-grid">
          ${select("department", "Department", [["", "Select Department"], ...departments.map((item) => [item.departmentName, item.departmentName])], selectedDept)}
          ${select("yearName", "Year", [["", "Select Year"], ...options.yearName.map((item) => [item, item])], selectedYear)}
          ${select("sectionName", "Section / Stream", [["", "Select Section / Stream"], ...options.sectionName.map((item) => [item, item])], selectedSection)}
          <div class="field actions" style="align-self:end"><button class="btn" type="submit">Apply Filters</button></div>
        </form>
      </section>` : ""}
      ${showForm ? `<section class="form-panel workflow-form">
        <h2>${editing.id ? "Edit Student" : "Add Student"}</h2>
        <form id="students-form" class="form-grid">
          ${enrichedFields.map((field) => fieldHtml(field, editing[field.name])).join("")}
          <div class="field full actions form-actions">
            <button class="btn" type="submit">${editing.id ? "Update" : "Create"}</button>
            <button class="btn secondary" type="button" data-clear-edit="${config.key}">Cancel</button>
          </div>
        </form>
      </section>` : ""}
      ${selectedView === "view" ? `<section class="panel" style="margin-top:16px">
        ${canSearch ? table(
          ["Student", "Roll Number", "Department", "Year", "Section / Stream", "Status", "Actions"],
          rows.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.studentName)}</strong><br><span class="muted">${escapeHtml(row.email || "-")}</span></td>
              <td>${escapeHtml(row.rollNumber)}</td>
              <td>${escapeHtml(row.department || "-")}</td>
              <td>${escapeHtml(row.yearName || "-")}</td>
              <td>${escapeHtml(row.sectionName || "-")}</td>
              <td>${badge(row.status)}</td>
              <td class="actions">${editDelete("students", row.id, "/api/admin/student-records", row)}</td>
            </tr>
          `)
        ) : `<p class="muted">Select Department, Year, and Section / Stream to view students.</p>`}
      </section>` : ""}
    `
  );

  const form = document.querySelector("#students-form");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!hasDepartments) {
        setFlash("Please create a department first.", "error", "students");
        render();
        return;
      }
      const body = formObject(event.currentTarget);
      for (const field of enrichedFields) {
        if (field.type === "number") body[field.name] = Number(body[field.name]);
        if (field.blankToNull && body[field.name] === "") body[field.name] = null;
      }
      await api(editing.id ? `${config.path}/${editing.id}` : config.path, {
        method: editing.id ? "PUT" : "POST",
        body: JSON.stringify(body)
      });
      state.edit[config.key] = null;
      state.edit.adminStudentView = "view";
      render();
    });
  }

  const filterForm = document.querySelector("#student-filter-form");
  if (filterForm) {
    filterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = formObject(event.currentTarget);
      state.edit.adminStudentDept = body.department || "";
      state.edit.adminStudentYear = body.yearName || "";
      state.edit.adminStudentSection = body.sectionName || "";
      render();
    });
  }

  for (const button of document.querySelectorAll("[data-student-view]")) {
    button.addEventListener("click", () => {
      state.edit.adminStudentView = button.dataset.studentView || "view";
      render();
    });
  }
}

async function adminFacultyPage() {
  const [rows, bootstrap] = await Promise.all([api("/api/faculty-records"), api("/api/bootstrap")]);
  const departments = (bootstrap.departments || []).filter((row) => row.status !== "Inactive");
  const hasDepartments = departments.length > 0;
  const selectedView = state.edit.adminFacultyView || "view";
  const selectedDept = state.edit.adminFacultyDept || "";
  const workloadByFaculty = new Map();
  for (const faculty of rows) workloadByFaculty.set(faculty.id, 0);
  for (const slot of bootstrap.adminCourses || []) {
    const facultyId = Number(slot.facultyRecordId || 0);
    if (facultyId) workloadByFaculty.set(facultyId, (workloadByFaculty.get(facultyId) || 0) + Number(slot.theoryHoursPerWeek || 0) + Number(slot.labHoursPerWeek || 0));
  }
  const mappingsByFaculty = new Map();
  for (const mapping of bootstrap.facultyCourseMappings || []) {
    if (!mappingsByFaculty.has(mapping.facultyId)) mappingsByFaculty.set(mapping.facultyId, []);
    mappingsByFaculty.get(mapping.facultyId).push(String(mapping.courseCode || "").toUpperCase());
  }
  const enrichedRows = rows.map((row) => ({
    ...row,
    workload: workloadByFaculty.get(row.id) || 0,
    teachableCourseCodes: mappingsByFaculty.get(row.id) || []
  }));
  const filteredRows = selectedDept ? enrichedRows.filter((row) => String(row.department || "") === String(selectedDept)) : [];
  const config = crudConfig("faculty");
  const editing = state.edit[config.key] || {};
  const showForm = selectedView === "add" || Boolean(editing.id || editing.__create);
  const editableCourseCodes = Array.isArray(editing.subject_expertise) ? editing.subject_expertise : (Array.isArray(editing.teachableCourseCodes) ? editing.teachableCourseCodes : (editing.teachableCourseCodes ? String(editing.teachableCourseCodes).split(",").map((item) => item.trim()).filter(Boolean) : []));
  const normalizeDepartmentKey = (value) => String(value || "").trim().toUpperCase().replace(/&/g, "AND").replace(/\s+/g, "");
  const selectedFormDepartment = String(editing.department || (departments[0] ? departments[0].departmentName : ""));
  const courseOptions = (bootstrap.courses || [])
    .filter((course) =>
      selectedFormDepartment &&
      normalizeDepartmentKey(course.department) === normalizeDepartmentKey(selectedFormDepartment)
    )
    .map((course) => `<option value="${escapeHtml(course.code)}" ${editableCourseCodes.includes(course.code) ? "selected" : ""}>${escapeHtml(`${course.code} - ${course.name}`)}</option>`).join("");
  const enrichedFields = config.fields.map((field) => {
    if (field.name === "department") {
      return { ...field, kind: "select", options: departments.map((item) => [item.departmentName, item.departmentName]) };
    }
    return field;
  });
  shell(
    config.title,
    "Add faculty by department and subject expertise. View by department only.",
    `
      ${flashHtml("faculty")}
      ${hasDepartments ? "" : `<section class="notice error">No active department found. Create departments first.<div style="margin-top:10px">${button("Go to Departments", "/admin/departments", "secondary")}</div></section>`}
      <section class="crud-toolbar">
        <button class="btn ${selectedView === "add" ? "" : "secondary"}" data-faculty-view="add" ${hasDepartments ? "" : "disabled"}>Add Faculty</button>
        <button class="btn ${selectedView === "view" ? "" : "secondary"}" data-faculty-view="view">View Faculty</button>
      </section>
      ${selectedView === "view" ? `<section class="form-panel">
        <h2>Filter Faculty</h2>
        <form id="faculty-filter-form" class="form-grid">
          ${select("department", "Department", [["", "Select Department"], ...departments.map((item) => [item.departmentName, item.departmentName])], selectedDept)}
          <div class="field actions" style="align-self:end"><button class="btn" type="submit">Apply Filter</button></div>
        </form>
      </section>` : ""}
      ${showForm ? `<section class="form-panel workflow-form">
        <h2>${editing.id ? "Edit Faculty" : "Add Faculty"}</h2>
        <form id="faculty-form" class="form-grid">
          ${enrichedFields.map((field) => fieldHtml(field, editing[field.name])).join("")}
          <div class="field full">
            <label>Subject Expertise (from Registration Courses) ${selectedFormDepartment ? "" : "(Select department first)"}</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <select id="faculty-expertise-dropdown" style="flex:1;">
                <option value="">Select registration course</option>
                ${courseOptions}
              </select>
              <button class="btn secondary" type="button" id="faculty-expertise-add">Add Selected</button>
            </div>
            <select id="faculty-courses-select" multiple size="6" style="display:none;">
              ${courseOptions}
            </select>
            <div id="faculty-expertise-selected-list" style="margin-top:8px; min-height:36px; display:flex; gap:8px; flex-wrap:wrap; padding:8px; border:1px solid #d8dee9; border-radius:8px; background:#fff;"></div>
            <small class="muted">Choose from dropdown, then click Add Selected (or press Enter). Click x to remove.</small>
          </div>
          <div class="field full actions form-actions">
            <button class="btn" type="submit">${editing.id ? "Update" : "Create"}</button>
            <button class="btn secondary" type="button" data-clear-edit="${config.key}">Cancel</button>
          </div>
        </form>
      </section>` : ""}
      ${selectedView === "view" ? `<section class="panel" style="margin-top:16px">
        ${selectedDept ? table(
          ["Faculty", "Department", "Subject Expertise", "Workload", "Status", "Actions"],
          filteredRows.map((faculty) => `
            <tr>
              <td><strong>${escapeHtml(faculty.facultyName)}</strong><br><span class="muted">${escapeHtml(faculty.email || "-")}</span></td>
              <td>${escapeHtml(faculty.department || "-")}</td>
              <td>${escapeHtml((faculty.teachableCourseCodes || []).join(", ") || "-")}</td>
              <td>${escapeHtml(`${faculty.workload || 0} / ${faculty.maxWorkload || 0}`)}</td>
              <td>${badge(faculty.status)}</td>
              <td class="actions">${editDelete("faculty", faculty.id, "/api/faculty-records", faculty)}</td>
            </tr>
          `)
        ) : `<p class="muted">Select Department to view faculty.</p>`}
      </section>` : ""}
    `
  );

  const form = document.querySelector("#faculty-form");
  if (form) {
    const expertiseSelect = document.querySelector("#faculty-courses-select");
    const expertiseDropdown = document.querySelector("#faculty-expertise-dropdown");
    const expertiseAddButton = document.querySelector("#faculty-expertise-add");
    const expertiseSelectedList = document.querySelector("#faculty-expertise-selected-list");
    if (expertiseSelect && expertiseDropdown && expertiseAddButton && expertiseSelectedList) {
      const selectedCodes = new Set(
        Array.from(expertiseSelect.options)
          .filter((option) => option.selected)
          .map((option) => String(option.value || "").toUpperCase())
      );
      const syncSelectFromExpertise = () => {
        for (const option of Array.from(expertiseSelect.options)) {
          option.selected = selectedCodes.has(String(option.value || "").toUpperCase());
        }
      };
      const renderSelectedExpertise = () => {
        const selected = Array.from(expertiseSelect.options).filter((option) => selectedCodes.has(String(option.value || "").toUpperCase()));
        expertiseSelectedList.innerHTML = selected.map((option) => `<button class="btn secondary" type="button" data-remove-expertise="${escapeHtml(option.value)}" style="display:inline-flex; align-items:center; gap:6px;">${escapeHtml(option.text)} <span aria-hidden="true">x</span></button>`).join("");
      };
      const addOptionToExpertise = (option) => {
        if (!option) return;
        selectedCodes.add(String(option.value || "").toUpperCase());
        syncSelectFromExpertise();
        renderSelectedExpertise();
      };
      const addSelectedFromDropdown = () => {
        const selectedOption = expertiseDropdown.options[expertiseDropdown.selectedIndex];
        if (!selectedOption || !selectedOption.value) return;
        const courseOption = Array.from(expertiseSelect.options).find((option) => String(option.value) === String(selectedOption.value));
        if (!courseOption) return;
        addOptionToExpertise(courseOption);
        expertiseDropdown.value = "";
      };
      expertiseDropdown.addEventListener("change", () => {
        // Keep dropdown selection stable; add via Enter or explicit button.
      });
      expertiseDropdown.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addSelectedFromDropdown();
      });
      expertiseAddButton.addEventListener("click", () => {
        addSelectedFromDropdown();
      });
      expertiseSelect.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const selectedOption = expertiseSelect.options[expertiseSelect.selectedIndex];
        addOptionToExpertise(selectedOption);
      });
      expertiseSelectedList.addEventListener("click", (event) => {
        const rawClickTarget = event.target;
        const clickTarget = rawClickTarget instanceof Element
          ? rawClickTarget
          : (rawClickTarget && rawClickTarget.parentElement ? rawClickTarget.parentElement : null);
        if (!clickTarget) return;
        const removeButton = clickTarget.closest("[data-remove-expertise]");
        if (!removeButton) return;
        const code = String(removeButton.dataset.removeExpertise || "").toUpperCase();
        selectedCodes.delete(code);
        syncSelectFromExpertise();
        renderSelectedExpertise();
      });
      syncSelectFromExpertise();
      renderSelectedExpertise();
    }

    form.addEventListener("change", (event) => {
      const target = event.target;
      if (target && (target.id === "faculty-expertise-dropdown" || target.id === "faculty-courses-select")) {
        return;
      }
      const body = formObject(event.currentTarget);
      state.edit[config.key] = { ...(state.edit[config.key] || { __create: true }), ...body };
      render();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!hasDepartments) {
        setFlash("Please create a department first.", "error", "faculty");
        render();
        return;
      }
      const body = formObject(event.currentTarget);
      const selectedCodes = Array.from(document.querySelectorAll("#faculty-courses-select option:checked")).map((option) => option.value);
      if (!selectedCodes.length) {
        setFlash("Please add at least one subject expertise course.", "error", "faculty");
        render();
        return;
      }
      for (const field of enrichedFields) {
        if (field.type === "number") body[field.name] = Number(body[field.name]);
        if (field.blankToNull && body[field.name] === "") body[field.name] = null;
      }
      try {
        const saved = await api(editing.id ? `${config.path}/${editing.id}` : config.path, {
          method: editing.id ? "PUT" : "POST",
          body: JSON.stringify(body)
        });
        await api(`/api/faculty-records/${saved.id}/course-mappings`, {
          method: "PUT",
          body: JSON.stringify({ courseCodes: selectedCodes })
        });
        state.edit[config.key] = null;
        state.edit.adminFacultyView = "view";
        setFlash(editing.id ? "Faculty updated successfully." : "Faculty created successfully.", "success", "faculty");
      } catch (error) {
        setFlash(error.message || "Could not save faculty. Check Faculty ID/Email uniqueness and selected expertise mapping.", "error", "faculty");
      }
      render();
    });
  }

  const filterForm = document.querySelector("#faculty-filter-form");
  if (filterForm) {
    filterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = formObject(event.currentTarget);
      state.edit.adminFacultyDept = body.department || "";
      render();
    });
  }

  for (const button of document.querySelectorAll("[data-faculty-view]")) {
    button.addEventListener("click", () => {
      state.edit.adminFacultyView = button.dataset.facultyView || "view";
      render();
    });
  }
}

async function adminDepartmentsPage() {
  const yearOptionsByProgram = (program) => {
    const normalized = normalizeProgramName(program || "B.Tech");
    return normalized === "M.Tech" ? ["1st Year", "2nd Year"] : ["1st Year", "2nd Year", "3rd Year", "4th Year"];
  };
  const semesterOptionsByYear = (yearName, program) => {
    const normalizedProgram = normalizeProgramName(program || "B.Tech");
    const yearNo = yearOrdinalFromName(yearName);
    if (normalizedProgram === "M.Tech") {
      if (yearNo === 1) return [["1", "1"], ["2", "2"]];
      if (yearNo === 2) return [["3", "3"], ["4", "4"]];
      return [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]];
    }
    if (yearNo === 1) return [["1", "1"], ["2", "2"]];
    if (yearNo === 2) return [["3", "3"], ["4", "4"]];
    if (yearNo === 3) return [["5", "5"], ["6", "6"]];
    if (yearNo === 4) return [["7", "7"], ["8", "8"]];
    return [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"], ["8", "8"]];
  };
  const defaultSemesterForYear = (yearName, program) => {
    const dynamicOptions = semesterOptionsByYear(yearName, program);
    return dynamicOptions.length ? String(dynamicOptions[0][0] || "") : "";
  };

  let rows = [];
  let groups = [];
  try {
    [rows, groups] = await Promise.all([api("/api/departments"), api("/api/groups")]);
  } catch (_error) {
    rows = [];
    groups = [];
  }
  const activeDepartments = rows.filter((row) => row.status !== "Inactive");
  const selectedDepartment = state.edit.departmentGroupDepartment || (activeDepartments[0] ? activeDepartments[0].departmentName : "");
  const editing = state.edit.departments || {};
  const rawGroupEditing = state.edit.departmentGroup || {};
  const effectiveGroupProgram = normalizeProgramName(rawGroupEditing.program || "B.Tech");
  const groupYearOptions = yearOptionsByProgram(effectiveGroupProgram);
  const effectiveGroupYear = String(rawGroupEditing.yearName || groupYearOptions[0] || "1st Year");
  const dynamicSemesterOptions = semesterOptionsByYear(effectiveGroupYear, effectiveGroupProgram);
  const hasExplicitSemester = Object.prototype.hasOwnProperty.call(rawGroupEditing, "semester");
  const groupEditing = {
    ...rawGroupEditing,
    program: effectiveGroupProgram,
    yearName: effectiveGroupYear,
    semester: hasExplicitSemester
      ? String(rawGroupEditing.semester || "")
      : String(defaultSemesterForYear(effectiveGroupYear, effectiveGroupProgram))
  };
  const departmentGroups = selectedDepartment
    ? groups.filter((group) => String(group.department || "") === String(selectedDepartment))
    : [];
  shell(
    "Departments",
    "Create departments first, then manage groups under each department.",
    `
      ${flashHtml("departments")}
      <section class="crud-toolbar">
        <div>
          <strong>${rows.length}</strong>
          <span class="muted">${rows.length === 1 ? "Department" : "Departments"} found</span>
        </div>
      </section>
      <section class="form-panel workflow-form">
        <h2>${editing.id ? "Edit Department" : "Create Department"}</h2>
        <form id="departments-form" class="form-grid">
          ${input("departmentName", "Department / Branch", editing.departmentName || "")}
          ${select("status", "Status", options.groupStatus, editing.status || "Active")}
          <div class="field full actions form-actions">
            <button class="btn" type="submit">${editing.id ? "Update" : "Create"}</button>
            ${editing.id ? `<button class="btn secondary" type="button" data-clear-edit="departments">Cancel</button>` : ""}
          </div>
        </form>
      </section>
      <section class="grid">
        <article class="list-panel">
          ${table(
            ["Department", "Status", "Actions"],
            rows.map((row) => `
              <tr>
                <td><strong class="record-name">${escapeHtml(row.departmentName || "")}</strong></td>
                <td>${badge(row.status)}</td>
                <td class="actions">${editDelete("departments", row.id, "/api/departments", row)}</td>
              </tr>
            `)
          )}
        </article>
      </section>
      <section class="form-panel workflow-form" style="margin-top:16px">
        <h2>Department Groups</h2>
        ${activeDepartments.length ? `<form id="department-group-selector" class="form-grid">
          ${select("departmentName", "Department", activeDepartments.map((row) => [row.departmentName, row.departmentName]), selectedDepartment)}
        </form>` : `<p class="muted">Create an active department first.</p>`}
        ${selectedDepartment ? `<div style="margin-top:12px">
          <h3 style="margin-bottom:8px">${escapeHtml(selectedDepartment)} Groups</h3>
          ${table(
            ["Program", "Year", "Semester", "Section / Stream", "Strength", "Status", "Actions"],
            departmentGroups.map((group) => {
              const semesterDisplay = String(group.semester || "").trim() || defaultSemesterForYear(group.yearName) || "-";
              return `
              <tr>
                <td>${escapeHtml(group.program || "B.Tech")}</td>
                <td>${escapeHtml(group.yearName || "-")}</td>
                <td>${escapeHtml(semesterDisplay)}</td>
                <td>${escapeHtml(group.sectionName || "-")}</td>
                <td>${escapeHtml(String(group.strength || 0))}</td>
                <td>${badge(group.status)}</td>
                <td class="actions">
                  <button class="btn secondary" data-edit-dept-group="${group.id}">Edit</button>
                  <button class="btn danger" data-delete="/api/groups/${group.id}">Delete</button>
                </td>
              </tr>
            `;
            })
          )}
        </div>` : ""}
      </section>
      ${selectedDepartment ? `<section class="form-panel workflow-form" style="margin-top:16px">
        <h2>${groupEditing.id ? "Edit Group" : "Add Group"} under ${escapeHtml(selectedDepartment)}</h2>
        <form id="department-group-form" class="form-grid">
          ${select("program", "Program", options.program, groupEditing.program || "B.Tech")}
          ${select("yearName", "Year", groupYearOptions, groupEditing.yearName || "")}
          ${select("semester", "Semester", dynamicSemesterOptions, groupEditing.semester || "")}
          ${input("sectionName", "Section", groupEditing.sectionName || "")}
          ${input("strength", "Strength", groupEditing.strength || "", "number")}
          ${select("status", "Status", options.groupStatus, groupEditing.status || "Active")}
          <div class="field full"><small class="muted">Allowed for ${escapeHtml(groupEditing.yearName || "-")}: ${escapeHtml(dynamicSemesterOptions.map((item) => item[0]).join(" / "))}.</small></div>
          <div class="field full actions form-actions">
            <button class="btn" type="submit">${groupEditing.id ? "Update Group" : "Add Group"}</button>
            ${groupEditing.id ? `<button class="btn secondary" type="button" data-clear-edit="departmentGroup">Cancel</button>` : ""}
          </div>
        </form>
      </section>` : ""}
    `
  );

  const form = document.querySelector("#departments-form");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = formObject(event.currentTarget);
      try {
        await api(editing.id ? `/api/departments/${editing.id}` : "/api/departments", {
          method: editing.id ? "PUT" : "POST",
          body: JSON.stringify(body)
        });
        setFlash(editing.id ? "Department updated successfully." : "Department created successfully.", "success", "departments");
        state.edit.departments = null;
      } catch (error) {
        setFlash(error.message || "Could not save department.", "error", "departments");
      }
      render();
    });
  }

  const selector = document.querySelector("#department-group-selector");
  if (selector) {
    selector.addEventListener("change", (event) => {
      const body = formObject(event.currentTarget);
      state.edit.departmentGroupDepartment = body.departmentName || "";
      state.edit.departmentGroup = null;
      render();
    });
  }

  const groupForm = document.querySelector("#department-group-form");
  if (groupForm) {
    groupForm.addEventListener("change", (event) => {
      const body = formObject(event.currentTarget);
      if (event.target && event.target.name === "semester") {
        state.edit.departmentGroup = { ...(state.edit.departmentGroup || {}), ...body, semester: String(body.semester || "") };
        render();
        return;
      }
      if (event.target && event.target.name === "program") {
        const yearOptions = yearOptionsByProgram(body.program || "B.Tech");
        body.yearName = yearOptions.includes(String(body.yearName || "")) ? String(body.yearName || "") : String(yearOptions[0] || "1st Year");
        body.semester = defaultSemesterForYear(body.yearName, body.program || "B.Tech");
      }
      if (event.target && event.target.name === "yearName") {
        const recommended = semesterOptionsByYear(body.yearName, body.program || "B.Tech").map((item) => item[0]);
        const selectedSemester = String(body.semester || "");
        if (!selectedSemester || !recommended.includes(selectedSemester)) {
          body.semester = defaultSemesterForYear(body.yearName, body.program || "B.Tech");
        }
      }
      state.edit.departmentGroup = { ...(state.edit.departmentGroup || {}), ...body };
      render();
    });
    groupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = formObject(event.currentTarget);
      if (!body.semester) {
        setFlash("Semester is required for group.", "error", "departments");
        render();
        return;
      }
      const allowedSemesters = semesterOptionsByYear(body.yearName, body.program || "B.Tech").map((item) => item[0]);
      if (!allowedSemesters.includes(String(body.semester || "").trim())) {
        setFlash(`Semester must match selected year (${allowedSemesters.join(" / ")}).`, "error", "departments");
        render();
        return;
      }
      body.department = selectedDepartment;
      try {
        await api(groupEditing.id ? `/api/groups/${groupEditing.id}` : "/api/groups", {
          method: groupEditing.id ? "PUT" : "POST",
          body: JSON.stringify(body)
        });
        state.edit.departmentGroup = null;
        setFlash(groupEditing.id ? "Group updated successfully." : "Group created successfully.", "success", "departments");
      } catch (error) {
        setFlash(error.message || "Could not save group.", "error", "departments");
      }
      render();
    });
  }

  for (const button of document.querySelectorAll("[data-edit-dept-group]")) {
    button.addEventListener("click", () => {
      const groupId = Number(button.dataset.editDeptGroup || 0);
      const row = groups.find((item) => Number(item.id) === groupId);
      if (!row) return;
      state.edit.departmentGroup = {
        ...row,
        program: normalizeProgramName(row.program || "B.Tech"),
        semester: String(row.semester || "").trim() || defaultSemesterForYear(row.yearName, row.program || "B.Tech")
      };
      render();
    });
  }
}

async function adminDashboard() {
  const [data, alertsData] = await Promise.all([
    api("/api/admin/dashboard"),
    api("/api/admin/faculty-absent-alerts?unresolved=true")
  ]);
  const alerts = alertsData.alerts || [];
  shell(
    "Admin Dashboard",
    "Overview of students, faculty, courses and registrations.",
    `
      ${metrics([
        ["Students", data.totalStudents],
        ["Faculty", data.totalFaculty],
        ["Courses", data.totalCourses],
        ["Registrations", data.totalRegistrations],
        ["Open Courses", data.openCourses],
        ["Absence Alerts", alerts.length]
      ])}
      ${flashHtml("admin-dashboard")}
      <section class="grid two-col" style="margin-top:16px">
        <article class="panel">
          <h2>Department Breakdown</h2>
          ${table(["Department", "Courses", "Students"], data.departmentBreakdown.map((item) => `
            <tr><td>${escapeHtml(item.department)}</td><td>${item.courseCount}</td><td>${item.studentCount}</td></tr>
          `))}
        </article>
        <article class="panel">
          <h2>Recent Registrations</h2>
          ${table(["Course", "Student", "Status"], data.recentRegistrations.map((item) => `
            <tr><td>${escapeHtml(item.courseCode)}<br><span class="muted">${escapeHtml(item.courseName)}</span></td><td>${escapeHtml(item.studentName)}</td><td>${badge(item.status)}</td></tr>
          `))}
        </article>
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>Pending Faculty Absence Alerts</h2>
        ${table(
          ["Faculty", "Course", "Group", "Slot", "Status"],
          alerts.slice(0, 10).map((item) => `
            <tr>
              <td>${escapeHtml(item.facultyName)}</td>
              <td><strong>${escapeHtml(item.courseCode)}</strong><br><span class="muted">${escapeHtml(item.courseName)}</span></td>
              <td>${escapeHtml(item.groupName || "-")}</td>
              <td>${escapeHtml(item.day)} P${item.period}<br><span class="muted">${escapeHtml(item.timeSlot || "")}</span></td>
              <td>${badge(item.resolved ? "Resolved" : "Absent")}</td>
            </tr>
          `)
        )}
        <div style="margin-top:12px">${button("Manage Alerts", "/admin/faculty-alerts", "secondary")}</div>
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>AI & DS Dummy Data</h2>
        <p class="muted">Wipes academic/timetable records and creates only AI and DS (Medical/Non-Medical x 1st/2nd Year x A/B) with faculty, students, courses, and teaching plan links.</p>
        <button class="btn" data-generate-ai-ds-dummy="1">Generate AI & DS Dummy Data</button>
      </section>
    `
  );
}

async function adminCourses() {
  const [courses, bootstrap] = await Promise.all([api("/api/courses"), api("/api/bootstrap")]);
  const bootstrapCourseById = new Map((bootstrap.courses || []).map((course) => [Number(course.id), course]));
  const yearOptionsByProgram = (program) => {
    const normalized = normalizeProgramName(program || "B.Tech");
    return normalized === "M.Tech" ? [["1st Year", "1st Year"], ["2nd Year", "2nd Year"]] : [["1st Year", "1st Year"], ["2nd Year", "2nd Year"], ["3rd Year", "3rd Year"], ["4th Year", "4th Year"]];
  };
  const semesterOptionsByYear = (yearName, program) => {
    const normalizedProgram = normalizeProgramName(program || "B.Tech");
    const yearNo = yearOrdinalFromName(yearName);
    if (normalizedProgram === "M.Tech") {
      if (yearNo === 1) return [["1", "1"], ["2", "2"]];
      if (yearNo === 2) return [["3", "3"], ["4", "4"]];
      return [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]];
    }
    if (yearNo === 1) return [["1", "1"], ["2", "2"]];
    if (yearNo === 2) return [["3", "3"], ["4", "4"]];
    if (yearNo === 3) return [["5", "5"], ["6", "6"]];
    if (yearNo === 4) return [["7", "7"], ["8", "8"]];
    return [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"], ["8", "8"]];
  };
  const defaultSemesterForYear = (yearName, program) => {
    const opts = semesterOptionsByYear(yearName, program);
    return opts.length ? String(opts[0][0]) : "";
  };
  const departmentRows = (bootstrap.departments || [])
    .filter((row) => row.status !== "Inactive")
    .map((row) => ({
      id: String(row.id),
      name: String(row.departmentName || "").trim()
    }))
    .filter((row) => row.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const departments = departmentRows
    .map((row) => row.name)
    .sort((a, b) => a.localeCompare(b));
  const departmentOptions = departmentRows.map((row) => [row.id, row.name]);
  const selectedDept = String(state.edit.adminCourseDept || "");
  const selectedProgram = normalizeProgramName(state.edit.adminCourseProgram || "B.Tech");
  const selectedYear = String(state.edit.adminCourseYear || "1st Year");
  const yearOptions = yearOptionsByProgram(selectedProgram);
  const normalizedSelectedYear = yearOptions.map((item) => item[0]).includes(selectedYear) ? selectedYear : String(yearOptions[0] ? yearOptions[0][0] : "1st Year");
  const semesterOptions = semesterOptionsByYear(normalizedSelectedYear, selectedProgram);
  let selectedSemester = String(state.edit.adminCourseSemester || "");
  const allowedSemesters = semesterOptions.map((item) => item[0]);
  if (!selectedSemester || !allowedSemesters.includes(selectedSemester)) {
    selectedSemester = defaultSemesterForYear(normalizedSelectedYear, selectedProgram);
  }
  const hasFilterContext = Boolean(selectedDept && selectedSemester);
  const filteredCourses = courses.filter((course) => {
    const source = bootstrapCourseById.get(Number(course.id)) || course;
    const department = String(source.department || course.department || "");
    const program = normalizeProgramName(source.program || course.program || "B.Tech");
    const semester = String(source.semester || course.semester || "").trim();
    const academicYear = String(source.academicYear || course.academicYear || semesterToYearName(semester) || "").trim();
    return (
      (!selectedDept || normalizeDepartmentKey(department) === normalizeDepartmentKey(selectedDept)) &&
      program === selectedProgram &&
      (!selectedSemester || semester === selectedSemester) &&
      (!normalizedSelectedYear || academicYear === normalizedSelectedYear)
    );
  });
  const editing = state.edit.course || {};
  const showForm = editing.id || editing.__create;
  shell(
    "Registration Courses",
    "Access courses by Department -> Year -> Semester. Add courses in the selected context only.",
    `
      ${flashHtml("courses")}
      <section class="form-panel" style="margin-top:12px">
        <form id="course-filter-form" class="form-grid">
          ${select("department", "Department", [["", "Select Department"], ...departments.map((item) => [item, item])], selectedDept)}
          ${select("program", "Program", options.program, selectedProgram)}
          ${select("yearName", "Year", yearOptions, normalizedSelectedYear)}
          ${select("semester", "Semester", semesterOptions, selectedSemester)}
        </form>
      </section>
      <section class="crud-toolbar">
        <div>
          <strong>${hasFilterContext ? filteredCourses.length : 0}</strong>
          <span class="muted">${hasFilterContext ? (filteredCourses.length === 1 ? "Course" : "Courses") : "Courses"} found</span>
        </div>
        ${showForm ? "" : `<button class="btn" data-create-key="course" ${hasFilterContext ? "" : "disabled"}>Create Course</button>`}
      </section>
      ${hasFilterContext ? "" : `<section class="notice">Select Department and Semester to view/create courses.</section>`}
      ${showForm ? `<section class="form-panel workflow-form">
        <h2>${editing.id ? "Edit Course" : "Create Course"}</h2>
        <form id="course-form" class="form-grid">
          ${input("code", "Code", editing.code)}
          ${input("name", "Name", editing.name)}
          ${select("departmentId", "Department", departmentOptions, (() => {
            const editMatch = departmentRows.find((row) => row.name === String(editing.department || ""));
            const selectedMatch = departmentRows.find((row) => row.name === String(selectedDept || ""));
            return (editMatch && editMatch.id) || (selectedMatch && selectedMatch.id) || "";
          })())}
          ${input("credits", "Credits", editing.credits, "number")}
          ${select("semester", "Semester", options.semester, selectedSemester || editing.semester || "")}
          ${editing.id ? input("maxSeats", "Max Seats", editing.maxSeats, "number") : input("maxSeats", "Max Seats", editing.maxSeats || "60", "number")}
          ${select("isOpen", "Registration", [["true", "Open"], ["false", "Closed"]], editing.isOpen === false ? "false" : "true")}
          ${textarea("description", "Description", editing.description)}
          <div class="field full actions form-actions">
            <button class="btn" type="submit">${editing.id ? "Update" : "Create"}</button>
            <button class="btn secondary" type="button" data-clear-edit="course">Cancel</button>
          </div>
        </form>
      </section>` : ""}
      <section class="grid">
        <article class="list-panel">
          ${table(["Code", "Course", "Seats", "Status", "Actions"], (hasFilterContext ? filteredCourses : []).map((course) => `
            <tr>
              <td>${escapeHtml(course.code)}</td>
              <td><strong class="record-name">${escapeHtml(course.name)}</strong><span class="record-meta">${escapeHtml(course.department)} / Semester ${escapeHtml(course.semester)}</span></td>
              <td>${course.enrolledCount}/${course.maxSeats}</td>
              <td>${badge(course.isOpen)}</td>
              <td class="actions">
                <button class="btn secondary" data-edit-course="${course.id}">Edit</button>
                <button class="btn danger" data-delete="/api/courses/${course.id}">Delete</button>
              </td>
            </tr>
          `))}
        </article>
      </section>
    `
  );

  const filterForm = document.querySelector("#course-filter-form");
  if (filterForm) {
    filterForm.addEventListener("change", (event) => {
      const body = formObject(event.currentTarget);
      const changed = event.target && event.target.name ? String(event.target.name) : "";
      if (changed === "department") {
        state.edit.adminCourseDept = body.department || "";
        state.edit.adminCourseProgram = normalizeProgramName(body.program || "B.Tech");
        const yearOpts = yearOptionsByProgram(state.edit.adminCourseProgram);
        const normalizedYear = yearOpts.map((item) => item[0]).includes(String(body.yearName || "")) ? String(body.yearName || "") : String(yearOpts[0] ? yearOpts[0][0] : "1st Year");
        state.edit.adminCourseYear = normalizedYear;
        state.edit.adminCourseSemester = defaultSemesterForYear(normalizedYear, state.edit.adminCourseProgram);
      } else if (changed === "program") {
        state.edit.adminCourseDept = body.department || "";
        state.edit.adminCourseProgram = normalizeProgramName(body.program || "B.Tech");
        const yearOpts = yearOptionsByProgram(state.edit.adminCourseProgram);
        state.edit.adminCourseYear = String(yearOpts[0] ? yearOpts[0][0] : "1st Year");
        state.edit.adminCourseSemester = defaultSemesterForYear(state.edit.adminCourseYear, state.edit.adminCourseProgram);
      } else if (changed === "yearName") {
        const nextSem = defaultSemesterForYear(body.yearName || "1st Year", body.program || "B.Tech");
        state.edit.adminCourseDept = body.department || "";
        state.edit.adminCourseProgram = normalizeProgramName(body.program || "B.Tech");
        state.edit.adminCourseYear = body.yearName || "1st Year";
        state.edit.adminCourseSemester = nextSem;
      } else {
        state.edit.adminCourseDept = body.department || "";
        state.edit.adminCourseProgram = normalizeProgramName(body.program || "B.Tech");
        state.edit.adminCourseYear = body.yearName || "1st Year";
        state.edit.adminCourseSemester = body.semester || "";
      }
      state.edit.course = null;
      render();
    });
  }

  const form = document.querySelector("#course-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    const contextYear = String(state.edit.adminCourseYear || "");
    const contextProgram = normalizeProgramName(state.edit.adminCourseProgram || "B.Tech");
    const selectedDepartmentId = String(body.departmentId || "").trim();
    const selectedDepartment = departmentRows.find((row) => row.id === selectedDepartmentId) || null;
    const contextDept = selectedDepartment ? selectedDepartment.name : "";
    const contextSemester = String(body.semester || "");
    const allowed = semesterOptionsByYear(contextYear, contextProgram).map((item) => item[0]);
    if (!contextDept) {
      setFlash("Department is required.", "error", "courses");
      render();
      return;
    }
    if (!contextSemester) {
      setFlash("Semester is required.", "error", "courses");
      render();
      return;
    }
    if (!allowed.includes(contextSemester)) {
      setFlash(`Selected semester does not match year (${allowed.join("/")}).`, "error", "courses");
      render();
      return;
    }
    body.departmentId = selectedDepartmentId;
    body.department = contextDept;
    body.program = contextProgram;
    body.academicYear = contextYear;
    body.semester = contextSemester;
    body.credits = Number(body.credits);
    body.maxSeats = Number(body.maxSeats);
    body.isOpen = body.isOpen === "true";
    try {
      await api(editing.id ? `/api/courses/${editing.id}` : "/api/courses", {
        method: editing.id ? "PUT" : "POST",
        body: JSON.stringify(body)
      });
      state.edit.course = null;
      setFlash(editing.id ? "Course updated successfully." : "Course created successfully.", "success", "courses");
    } catch (error) {
      setFlash(error.message || "Could not save course.", "error", "courses");
    }
    render();
  });
}

async function genericCrud(config) {
  const [rows, bootstrap] = await Promise.all([api(config.path), api("/api/bootstrap")]);
  const groupSemesterValue = (group) => String((group && group.semester) || "").trim() || fallbackSemesterFromYear(group ? group.yearName : "");
  const displayRows = config.enrichRows ? rows.map((row) => config.enrichRows(row, bootstrap)) : rows;
  const teachingPlanFilters = state.edit.adminCourseFilters || {};
  const editing = state.edit[config.key] || {};
  const editingForForm = config.key === "groups"
    ? {
      ...editing,
      streamName: editing.streamName || parseGroupSectionName(editing.sectionName).streamName,
      sectionCode: editing.sectionCode || parseGroupSectionName(editing.sectionName).sectionCode
    }
    : editing;
  const editingSourceCourseId = Number(editing.sourceCourseId || 0);
  const editingFacultyRecordId = Number(editing.facultyRecordId || 0);
  const selectedPlanningDepartment = String(editing.department || "");
  const selectedPlanningProgram = normalizeProgramName(editing.program || "B.Tech");
  const selectedPlanningSemester = String(editing.semester || "");
  const selectedPlanningYear = String(editing.academicYear || semesterToYearName(selectedPlanningSemester) || "");
  const allowedPlanningSemesters = semesterOptionsByYearName(selectedPlanningYear);
  const normalizedPlanningSemester = selectedPlanningSemester && allowedPlanningSemesters.includes(selectedPlanningSemester)
    ? selectedPlanningSemester
    : (allowedPlanningSemesters[0] || "");
  const selectedPlanningCourse = (bootstrap.courses || []).find((course) => Number(course.id) === editingSourceCourseId) || null;
  const selectedPlanningCourseCode = selectedPlanningCourse ? String(selectedPlanningCourse.code || "").toUpperCase() : "";
  const selectedPlanningYearBySemester = semesterToYearName(selectedPlanningSemester);
  const selectedFaculty = bootstrap.facultyRecords.find((faculty) => Number(faculty.id) === editingFacultyRecordId) || null;
  const selectedFacultyDepartment = String((selectedFaculty && selectedFaculty.department) || "");
  const formOnDemand = config.formOnDemand !== false;
  const showForm = !formOnDemand || editing.id || editing.__create;
  let filteredRows = displayRows;
  let teachingPlanFilterHtml = "";
  if (config.key === "adminCourseRecords") {
    const selectedDept = String(teachingPlanFilters.department || "");
    const selectedProgramFilter = normalizeProgramFilter(teachingPlanFilters.program || "");
    const selectedYear = String(teachingPlanFilters.yearName || "");
    const selectedSemesterFilter = String(teachingPlanFilters.semester || "");
    const selectedSection = String(teachingPlanFilters.sectionName || "");
    const groups = bootstrap.groups || [];
    const rowMeta = displayRows.map((row) => {
      const group = groups.find((item) => item.label === row.groupName) || null;
      const parsed = parseGroupNameFallback(row.groupName);
      const rowProgram = normalizeProgramName((row.program || (group ? group.program : "")) || "B.Tech");
      const rowDept = String((row.department || (group ? group.department : "")) || "");
      const rowYear = String((group ? group.yearName : parsed.yearName) || "");
      const rowSemester = String((group ? groupSemesterValue(group) : String(row.semester || "")) || "");
      const rowSection = String((group ? group.sectionName : parsed.sectionName) || "");
      return { row, rowProgram, rowDept, rowYear, rowSemester, rowSection };
    });
    const departments = Array.from(new Set(groups.map((group) => group.department || "").filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const yearOptions = Array.from(new Set(groups
      .filter((group) => (!selectedDept || String(group.department) === selectedDept) && (!selectedProgramFilter || normalizeProgramName(group.program || "B.Tech") === selectedProgramFilter))
      .map((group) => group.yearName || "")
      .filter(Boolean)
      .concat(rowMeta
        .filter((item) => (!selectedDept || item.rowDept === selectedDept) && (!selectedProgramFilter || item.rowProgram === selectedProgramFilter))
        .map((item) => item.rowYear)
        .filter(Boolean)))).sort((a, b) => a.localeCompare(b));
    const semesterOptions = Array.from(new Set(groups
      .filter((group) => (!selectedDept || String(group.department) === selectedDept) && (!selectedProgramFilter || normalizeProgramName(group.program || "B.Tech") === selectedProgramFilter) && (!selectedYear || String(group.yearName) === selectedYear))
      .map((group) => String(group.semester || "").trim())
      .filter(Boolean)
      .concat(rowMeta
        .filter((item) =>
          (!selectedDept || item.rowDept === selectedDept) &&
          (!selectedProgramFilter || item.rowProgram === selectedProgramFilter) &&
          (!selectedYear || item.rowYear === selectedYear)
        )
        .map((item) => item.rowSemester)
        .filter(Boolean)))).sort((a, b) => Number(a) - Number(b));
    const sectionOptions = Array.from(new Set(groups
      .filter((group) =>
        (!selectedDept || String(group.department) === selectedDept) &&
        (!selectedProgramFilter || normalizeProgramName(group.program || "B.Tech") === selectedProgramFilter) &&
        (!selectedYear || String(group.yearName) === selectedYear) &&
        (!selectedSemesterFilter || String(groupSemesterValue(group)) === selectedSemesterFilter)
      )
      .map((group) => group.sectionName || "")
      .filter(Boolean)
      .concat(rowMeta
        .filter((item) =>
          (!selectedDept || item.rowDept === selectedDept) &&
          (!selectedProgramFilter || item.rowProgram === selectedProgramFilter) &&
          (!selectedYear || item.rowYear === selectedYear) &&
          (!selectedSemesterFilter || item.rowSemester === selectedSemesterFilter)
        )
        .map((item) => item.rowSection)
        .filter(Boolean)))).sort((a, b) => a.localeCompare(b));

    filteredRows = rowMeta.filter((item) => {
      const { rowDept, rowProgram, rowYear, rowSemester, rowSection } = item;
      if (selectedDept && rowDept !== selectedDept) return false;
      if (selectedProgramFilter && rowProgram !== selectedProgramFilter) return false;
      if (selectedYear && rowYear !== selectedYear) return false;
      if (selectedSemesterFilter && rowSemester !== selectedSemesterFilter) return false;
      if (selectedSection && rowSection !== selectedSection) return false;
      return true;
    }).map((item) => item.row);

    teachingPlanFilterHtml = `
      <section class="form-panel" style="margin-top:12px">
        <form id="teaching-plan-filter" class="form-grid">
          ${select("department", "Department", [["", "All Departments"], ...departments.map((item) => [item, item])], selectedDept)}
          ${select("program", "Program", [["", "All Programs"], ...options.program.map((item) => [item, item])], selectedProgramFilter)}
          ${select("yearName", "Year", [["", "All Years"], ...yearOptions.map((item) => [item, item])], selectedYear)}
          ${select("semester", "Semester", [["", "All Semesters"], ...semesterOptions.map((item) => [item, item])], selectedSemesterFilter)}
          ${select("sectionName", "Section / Stream", [["", "All Section / Stream"], ...sectionOptions.map((item) => [item, item])], selectedSection)}
        </form>
      </section>
    `;
  }
  const enrichedFields = config.fields.map((field) => {
    if (field.name === "groupId") {
      return { ...field, options: bootstrap.groups.map((group) => [group.id, group.label]) };
    }
    if (field.optionsFrom === "groups") {
      if (config.key === "adminCourseRecords") {
        if (!selectedPlanningDepartment) return { ...field, options: [["", "Select department first"]] };
        if (!selectedPlanningSemester) return { ...field, options: [["", "Select semester first"]] };
        if (!selectedPlanningYear) return { ...field, options: [["", "Select academic year first"]] };
        const groupOptions = bootstrap.groups
          .filter((group) => normalizeDepartmentKey(group.department) === normalizeDepartmentKey(selectedPlanningDepartment))
          .filter((group) => normalizeProgramName(group.program || "B.Tech") === selectedPlanningProgram)
          .filter((group) => {
            const groupSemester = groupSemesterValue(group);
            return groupSemester === selectedPlanningSemester && String(group.yearName || "") === String(selectedPlanningYear || "");
          })
          .map((group) => [group.label, group.label]);
        return { ...field, options: [["", groupOptions.length ? "Select Group" : "No groups found for selected department/year/semester"], ...groupOptions] };
      }
      return { ...field, options: bootstrap.groups.map((group) => [group.label, group.label]) };
    }
    if (field.optionsFrom === "facultyRecords") {
      if (config.key === "adminCourseRecords") {
        if (!selectedPlanningDepartment) return { ...field, options: [["", "Select department first"]] };
        if (!selectedPlanningSemester) return { ...field, options: [["", "Select semester first"]] };
        if (!editingSourceCourseId || !selectedPlanningCourseCode) return { ...field, options: [["", "Select course first"]] };
        const facultyOptions = bootstrap.facultyRecords
          .filter((faculty) => faculty.status === "Active")
          .filter((faculty) => normalizeDepartmentKey(faculty.department) === normalizeDepartmentKey(selectedPlanningDepartment))
          .filter((faculty) =>
            (bootstrap.facultyCourseMappings || []).some(
              (mapping) =>
                Number(mapping.facultyId) === Number(faculty.id) &&
                String(mapping.courseCode || "").toUpperCase() === selectedPlanningCourseCode
            )
          )
          .map((faculty) => [faculty.id, `${faculty.facultyName} (${faculty.facultyId})`]);
        return { ...field, options: [["", facultyOptions.length ? "Select Faculty" : "No faculty eligible for selected course"], ...facultyOptions] };
      }
      return {
        ...field,
        options: bootstrap.facultyRecords
          .filter((faculty) => faculty.status === "Active")
          .map((faculty) => [faculty.id, `${faculty.facultyName} (${faculty.facultyId})`])
      };
    }
    if (field.optionsFrom === "registrationCourses") {
      if (config.key === "adminCourseRecords") {
        if (!selectedPlanningDepartment) return { ...field, options: [["", "Select department first"]] };
        if (!selectedPlanningSemester) return { ...field, options: [["", "Select semester first"]] };
        if (!selectedPlanningYear) return { ...field, options: [["", "Select academic year first"]] };
        const filteredCourses = bootstrap.courses
          .filter((course) => normalizeDepartmentKey(course.department) === normalizeDepartmentKey(selectedPlanningDepartment))
          .filter((course) => normalizeProgramName(course.program || "B.Tech") === selectedPlanningProgram)
          .filter((course) => String(course.semester || "") === selectedPlanningSemester)
          .filter((course) => String(course.academicYear || "") === String(selectedPlanningYear || ""));
        return {
          ...field,
          options: [["", filteredCourses.length ? "Select Course" : "No courses found for selected department/year/semester"], ...filteredCourses.map((course) => [course.id, `${course.code} - ${course.name}`])]
        };
      }
      return { ...field, options: [["", "Select Course"]] };
    }
    if (config.key === "adminCourseRecords" && field.name === "department") {
      const teachingDepartments = (bootstrap.departments || [])
        .filter((row) => row.status !== "Inactive")
        .map((row) => String(row.departmentName || "").trim())
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
        .sort((a, b) => a.localeCompare(b))
        .map((item) => [item, item]);
      return {
        ...field,
        kind: "select",
        options: [["", "Select Department"], ...teachingDepartments],
        value: selectedPlanningDepartment || ""
      };
    }
    if (config.key === "adminCourseRecords" && field.name === "program") {
      return {
        ...field,
        kind: "select",
        options: options.program,
        value: selectedPlanningProgram || "B.Tech"
      };
    }
    if (config.key === "adminCourseRecords" && field.name === "semester") {
      return {
        ...field,
        options: allowedPlanningSemesters,
        value: normalizedPlanningSemester || ""
      };
    }
    if (config.key === "adminCourseRecords" && field.name === "academicYear") {
      const yearOptions = yearOptionsByProgram(selectedPlanningProgram);
      return {
        ...field,
        kind: "select",
        options: yearOptions,
        value: (yearOptions.includes(selectedPlanningYear) ? selectedPlanningYear : yearOptions[0]) || selectedPlanningYearBySemester || ""
      };
    }
    return field;
  });

  shell(
    config.title,
    config.subtitle,
    `
      ${flashHtml(config.key)}
      ${config.emptyDependency && config.emptyDependency(bootstrap) ? `<div class="notice">${config.emptyDependency(bootstrap)}</div>` : ""}
      <section class="crud-toolbar">
        <div>
          <strong>${filteredRows.length}</strong>
          <span class="muted">${filteredRows.length === 1 ? config.singular : `${config.singular}s`} found</span>
        </div>
        ${formOnDemand && !showForm ? `<button class="btn" data-create-key="${config.key}">Create ${config.singular}</button>` : ""}
      </section>
      ${teachingPlanFilterHtml}
      ${showForm ? `<section class="form-panel workflow-form">
        <h2>${editing.id ? "Edit" : "Create"} ${config.singular}</h2>
        <form id="crud-form" class="form-grid">
          ${enrichedFields.map((field) => fieldHtml(field, editingForForm[field.name])).join("")}
          <div class="field full actions form-actions">
            <button class="btn" type="submit">${editing.id ? "Update" : "Create"}</button>
            ${formOnDemand || editing.id ? `<button class="btn secondary" type="button" data-clear-edit="${config.key}">Cancel</button>` : ""}
          </div>
        </form>
      </section>` : ""}
      <section class="grid">
        <article class="list-panel">
          ${table(config.headers, filteredRows.map((row) => config.row(row, bootstrap)))}
        </article>
      </section>
    `
  );

  const teachingPlanFilterForm = document.querySelector("#teaching-plan-filter");
  if (teachingPlanFilterForm) {
    teachingPlanFilterForm.addEventListener("change", (event) => {
      const body = formObject(event.currentTarget);
      state.edit.adminCourseFilters = {
        department: body.department || "",
        program: normalizeProgramFilter(body.program || ""),
        yearName: body.yearName || "",
        semester: body.semester || "",
        sectionName: body.sectionName || ""
      };
      render();
    });
  }

  const form = document.querySelector("#crud-form");
  if (form) {
    if (config.key === "adminCourseRecords") {
      form.addEventListener("change", (event) => {
        const changed = event.target && event.target.name ? String(event.target.name) : "";
        const body = formObject(event.currentTarget);
        if (changed === "department") {
          body.program = normalizeProgramName(body.program || "B.Tech");
          body.academicYear = body.academicYear || "1st Year";
          const allowedSemesters = semesterOptionsByYearName(body.academicYear);
          body.semester = allowedSemesters[0] || "";
          body.sourceCourseId = "";
          body.facultyRecordId = "";
          body.secondaryFacultyRecordId = "";
          body.groupName = "";
        }
        if (changed === "program") {
          body.program = normalizeProgramName(body.program || "B.Tech");
          body.academicYear = "1st Year";
          const allowedSemesters = semesterOptionsByYearName(body.academicYear);
          body.semester = allowedSemesters[0] || "";
          body.sourceCourseId = "";
          body.facultyRecordId = "";
          body.secondaryFacultyRecordId = "";
          body.groupName = "";
        }
        if (changed === "academicYear") {
          const allowedSemesters = semesterOptionsByYearName(body.academicYear);
          if (!allowedSemesters.includes(String(body.semester || ""))) {
            body.semester = allowedSemesters[0] || "";
          }
          body.sourceCourseId = "";
          body.facultyRecordId = "";
          body.secondaryFacultyRecordId = "";
          body.groupName = "";
        }
        if (changed === "semester") {
          body.sourceCourseId = "";
          body.facultyRecordId = "";
          body.secondaryFacultyRecordId = "";
          body.groupName = "";
          body.academicYear = semesterToYearNameForTrack(body.semester, body.academicYear);
        }
        if (changed === "sourceCourseId") {
          const selectedCourse = bootstrap.courses.find((item) => String(item.id) === String(body.sourceCourseId || ""));
          body.program = selectedCourse ? normalizeProgramName(selectedCourse.program || "B.Tech") : normalizeProgramName(body.program || "B.Tech");
          body.academicYear = selectedCourse ? semesterToYearNameForTrack(selectedCourse.semester, body.academicYear) : "";
          body.facultyRecordId = "";
          body.secondaryFacultyRecordId = "";
          body.semester = selectedCourse ? String(selectedCourse.semester || "") : body.semester;
          body.groupName = "";
        }
        if (changed === "facultyRecordId") body.groupName = "";
        state.edit[config.key] = { ...(state.edit[config.key] || { __create: true }), ...body };
        render();
      });
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const body = formObject(event.currentTarget);
        for (const field of enrichedFields) {
          if (field.type === "number") body[field.name] = Number(body[field.name]);
          if (field.blankToNull && body[field.name] === "") body[field.name] = null;
        }
        if (config.beforeSubmit) config.beforeSubmit(body, bootstrap);
        await api(editing.id ? `${config.path}/${editing.id}` : config.path, {
          method: editing.id ? "PUT" : "POST",
          body: JSON.stringify(body)
        });
        state.edit[config.key] = null;
      } catch (error) {
        setFlash(error.message || `Could not save ${config.singular}.`, "error", config.key);
      }
      render();
    });
  }
}

function crudConfig(kind) {
  const configs = {
    students: {
      key: "students",
      title: "Students",
      singular: "Student",
      subtitle: "Manage students using hierarchy: Department -> Year -> Semester -> Section / Stream.",
      path: "/api/admin/student-records",
      headers: ["Student", "Roll Number", "Department", "Year", "Section / Stream", "Status", "Actions"],
      fields: [
        { name: "rollNumber", label: "Roll Number" },
        { name: "studentName", label: "Student Name" },
        { name: "email", label: "Email", blankToNull: true },
        { name: "department", label: "Department", kind: "select", options: [] },
        { name: "yearName", label: "Year", kind: "select", options: options.yearName },
        { name: "semester", label: "Semester", kind: "select", options: options.semester },
        { name: "sectionName", label: "Section / Stream", kind: "select", options: options.sectionName },
        { name: "studentPassword", label: "Password" },
        { name: "status", label: "Status", kind: "select", options: options.studentStatus }
      ],
      row: (row) => `
        <tr>
          <td>
            <strong class="record-name">${escapeHtml(row.studentName)}</strong>
            <span class="record-meta">${escapeHtml(row.email || "No email added")}</span>
          </td>
          <td>${escapeHtml(row.rollNumber)}</td>
          <td>${escapeHtml(row.department || "-")}</td>
          <td>${escapeHtml(row.yearName || "-")}</td>
          <td>${escapeHtml(row.sectionName || "-")}</td>
          <td>${badge(row.status)}</td>
          <td class="actions">${editDelete("students", row.id, "/api/admin/student-records", row)}</td>
        </tr>`
    },
    faculty: {
      key: "faculty",
      title: "Faculty",
      singular: "Faculty",
      subtitle: "Manage faculty records and faculty logins.",
      path: "/api/faculty-records",
      headers: ["Faculty", "Faculty ID", "Department", "Workload", "Status", "Actions"],
      fields: [
        { name: "facultyId", label: "Faculty ID" },
        { name: "facultyName", label: "Faculty Name" },
        { name: "email", label: "Email" },
        { name: "department", label: "Department" },
        { name: "maxWorkload", label: "Max Workload", type: "number" },
        { name: "facultyPassword", label: "Password" },
        { name: "status", label: "Status", kind: "select", options: options.facultyStatus }
      ],
      row: (row) => `
        <tr>
          <td><strong class="record-name">${escapeHtml(row.facultyName)}</strong><span class="record-meta">${escapeHtml(row.email)}</span></td>
          <td>${escapeHtml(row.facultyId)}</td>
          <td>${escapeHtml(row.department)}</td>
          <td>${row.maxWorkload}</td>
          <td>${badge(row.status)}</td>
          <td class="actions">${editDelete("faculty", row.id, "/api/faculty-records", row)}</td>
        </tr>`
    },
    groups: {
      key: "groups",
      title: "Groups (Academic Structure)",
      singular: "Group",
      subtitle: "Define academic structure by Department, Year, Semester, and Section / Stream.",
      path: "/api/groups",
      headers: ["Program", "Year", "Semester", "Stream", "Section", "Department", "Strength", "Status", "Actions"],
      fields: [
        { name: "program", label: "Program", kind: "select", options: options.program },
        { name: "yearName", label: "Year", kind: "select", options: options.yearName },
        { name: "semester", label: "Semester", kind: "select", options: options.semester },
        { name: "streamName", label: "Stream", kind: "select", options: options.streamName },
        { name: "sectionCode", label: "Section" },
        { name: "department", label: "Department" },
        { name: "strength", label: "Strength", type: "number" },
        { name: "status", label: "Status", kind: "select", options: options.groupStatus }
      ],
      beforeSubmit(body) {
        body.sectionName = buildGroupSectionName(body.streamName, body.sectionCode, body.sectionName);
        delete body.streamName;
        delete body.sectionCode;
      },
      row: (row) => {
        const parts = parseGroupSectionName(row.sectionName);
        const semesterDisplay = String(row.semester || "").trim() || "-";
        return `
        <tr>
          <td>${escapeHtml(row.program || "B.Tech")}</td><td><strong class="record-name">${escapeHtml(row.yearName)}</strong></td><td>${escapeHtml(semesterDisplay)}</td><td>${escapeHtml(parts.streamName || "-")}</td><td>${escapeHtml(parts.sectionCode || "-")}</td><td>${escapeHtml(row.department)}</td><td>${row.strength}</td><td>${badge(row.status)}</td>
          <td class="actions">${editDelete("groups", row.id, "/api/groups", row)}</td>
        </tr>`;
      }
    },
    rooms: {
      key: "rooms",
      title: "Rooms",
      singular: "Room",
      subtitle: "Manage classrooms, labs and seminar halls for timetable generation.",
      path: "/api/rooms",
      headers: ["Room", "Type", "Specialization", "Capacity", "Status", "Actions"],
      fields: [
        { name: "roomNumber", label: "Room Number" },
        { name: "roomType", label: "Type", kind: "select", options: options.roomType },
        { name: "roomSpecialization", label: "Specialization", kind: "select", options: options.roomSpecialization },
        { name: "capacity", label: "Capacity", type: "number" },
        { name: "buildingName", label: "Building" },
        { name: "status", label: "Status", kind: "select", options: options.roomStatus }
      ],
      row: (row) => `
        <tr>
          <td><strong class="record-name">${escapeHtml(row.roomNumber)}</strong><span class="record-meta">${escapeHtml(row.buildingName)}</span></td><td>${escapeHtml(row.roomType)}</td><td>${escapeHtml(row.roomSpecialization)}</td><td>${row.capacity}</td><td>${badge(row.status)}</td>
          <td class="actions">${editDelete("rooms", row.id, "/api/rooms", row)}</td>
        </tr>`
    },
    adminCourseRecords: {
      key: "adminCourseRecords",
      title: "Teaching Plan",
      singular: "Planned Course",
      subtitle: "Create semester-based course-faculty-group mapping that drives timetable generation.",
      path: "/api/admin-courses",
      headers: ["Code", "Course", "Group", "Faculty", "Hours", "Room Need", "Status", "Actions"],
      emptyDependency(bootstrap) {
        if (!bootstrap.courses.length) return "Create at least one Registration Course before adding it to the Teaching Plan.";
        if (!bootstrap.groups.length) return "Create at least one Group before adding teaching plan rows.";
        if (!bootstrap.facultyRecords.length) return "Create at least one Faculty record before assigning planned courses.";
        return "";
      },
      enrichRows(row, bootstrap) {
        const assignments = (bootstrap.courseAssignments || []).filter((item) => Number(item.courseId) === Number(row.id));
        const assignmentFaculty = assignments
          .map((assignment) => bootstrap.facultyRecords.find((item) => Number(item.id) === Number(assignment.facultyId)))
          .filter(Boolean);
        const faculty = assignmentFaculty[0] || null;
        const secondaryFaculty = assignmentFaculty[1] || null;
        const registrationCourse = bootstrap.courses.find((course) => course.code === row.courseCode);
        return {
          ...row,
          sourceCourseId: registrationCourse ? registrationCourse.id : "",
          facultyRecordId: faculty ? faculty.id : "",
          secondaryFacultyRecordId: secondaryFaculty ? secondaryFaculty.id : "",
          facultyName: assignmentFaculty.length ? assignmentFaculty.map((item) => item.facultyName).join(" / ") : "Unassigned"
        };
      },
      fields: [
        { name: "department", label: "Department", kind: "select", options: [] },
        { name: "program", label: "Program", kind: "select", options: options.program },
        { name: "academicYear", label: "Academic Year", kind: "select", options: options.yearName },
        { name: "semester", label: "Semester", kind: "select", options: options.semester },
        { name: "sourceCourseId", label: "Registration Course", kind: "select", optionsFrom: "registrationCourses", allowBlank: true },
        { name: "facultyRecordId", label: "Primary Faculty", kind: "select", optionsFrom: "facultyRecords" },
        { name: "secondaryFacultyRecordId", label: "Secondary Faculty", kind: "select", optionsFrom: "facultyRecords", allowBlank: true },
        { name: "groupName", label: "Group", kind: "select", optionsFrom: "groups" },
        { name: "courseType", label: "Course Type", kind: "select", options: options.courseType },
        { name: "theoryHoursPerWeek", label: "Theory Hours", type: "number" },
        { name: "labHoursPerWeek", label: "Lab Hours", type: "number" },
        { name: "requiredRoomSpecialization", label: "Room Specialization", kind: "select", options: options.roomSpecialization },
        { name: "status", label: "Status", kind: "select", options: options.courseStatus }
      ],
      beforeSubmit(body, bootstrap) {
        if (!String(body.department || "").trim()) throw new Error("Select a department first.");
        if (!String(body.semester || "").trim()) throw new Error("Select semester.");
        const course = bootstrap.courses.find((item) => String(item.id) === String(body.sourceCourseId));
        if (!course) throw new Error("Select a registration course from the filtered list.");
        if (String(course.semester || "") !== String(body.semester || "")) throw new Error("Selected course is not in the selected semester.");
        if (normalizeDepartmentKey(course.department) !== normalizeDepartmentKey(body.department)) throw new Error("Selected course is not in the selected department.");
        const selectedFacultyRecord = bootstrap.facultyRecords.find((item) => String(item.id) === String(body.facultyRecordId));
        if (!selectedFacultyRecord) throw new Error("Select a faculty from the chosen course expertise list.");
        if (String(body.secondaryFacultyRecordId || "").trim() && String(body.secondaryFacultyRecordId) === String(body.facultyRecordId)) {
          throw new Error("Primary and secondary faculty must be different.");
        }
        body.courseCode = course.code;
        body.courseName = course.name;
        body.program = normalizeProgramName(body.program || "B.Tech");
        body.credits = Number(course.credits);
        body.academicYear = semesterToYearNameForTrack(body.semester, body.academicYear);
        delete body.sourceCourseId;
      },
      row: (row) => `
        <tr>
          <td>${escapeHtml(row.courseCode)}</td><td><strong class="record-name">${escapeHtml(row.courseName)}</strong><span class="record-meta">${escapeHtml(row.department)}</span></td><td>${escapeHtml(row.groupName)}</td><td>${escapeHtml(row.facultyName)}</td><td>T ${row.theoryHoursPerWeek} / L ${row.labHoursPerWeek}</td><td>${escapeHtml(row.requiredRoomSpecialization)}</td><td>${badge(row.status)}</td>
          <td class="actions">${editDelete("adminCourseRecords", row.id, "/api/admin-courses", row)}</td>
        </tr>`
    }
  };
  return configs[kind];
}

function editDelete(key, id, path, row) {
  const encoded = encodeURIComponent(JSON.stringify(row));
  return `
    <button class="btn secondary" data-edit-key="${key}" data-edit-row="${encoded}">Edit</button>
    <button class="btn danger" data-delete="${path}/${id}">Delete</button>
  `;
}

function input(name, label, value = "", type = "text") {
  return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${type === "number" ? "min=\"0\"" : ""}></div>`;
}

function textarea(name, label, value = "") {
  return `<div class="field full"><label>${label}</label><textarea name="${name}">${escapeHtml(value)}</textarea></div>`;
}

function select(name, label, items, selected = "", allowBlank = false) {
  const normalized = Array.isArray(items[0]) ? items : items.map((item) => [item, item]);
  const blank = allowBlank ? `<option value="">Unassigned</option>` : "";
  return `
    <div class="field">
      <label>${label}</label>
      <select name="${name}">
        ${blank}
        ${normalized.map(([value, text]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected ?? "") ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
      </select>
    </div>
  `;
}

function fieldHtml(field, value) {
  if (field.kind === "readonly") {
    return `<div class="field"><label>${field.label}</label><input name="${field.name}" type="text" value="${escapeHtml(field.value ?? value ?? "")}" readonly></div>`;
  }
  if (field.kind === "select") {
    return select(field.name, field.label, field.options, field.value ?? value, field.allowBlank);
  }
  return input(field.name, field.label, value, field.type || "text");
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function studentDashboard() {
  const data = await api("/api/student/dashboard");
  shell(
    "Student Dashboard",
    `Welcome, ${data.studentName}.`,
    `
      ${metrics([["Registered Courses", data.registeredCourses.length], ["Total Credits", data.totalCredits], ["Available Courses", data.availableCourses.length]])}
      <section class="panel" style="margin-top:16px">
        <h2>My Courses</h2>
        ${courseCards(data.registeredCourses, "registered")}
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>Available Courses</h2>
        ${courseCards(data.availableCourses, "available")}
      </section>
    `
  );
}

async function studentCourses() {
  const [courses, regs] = await Promise.all([api("/api/courses"), api("/api/student/registrations")]);
  const activeRegs = regs.filter((reg) => reg.status === "registered");
  const regByCourse = new Map(activeRegs.map((reg) => [reg.courseId, reg]));
  shell(
    "Courses",
    "Browse open courses and manage registration.",
    `<section class="course-list">${courses.map((course) => courseCard(course, regByCourse.get(course.id))).join("")}</section>`
  );
}

function courseCards(courses, mode) {
  return `<div class="course-list">${courses.length ? courses.map((course) => courseCard(course, null, mode)).join("") : `<p class="muted">No courses here yet.</p>`}</div>`;
}

function courseCard(course, registration, mode = "") {
  return `
    <article class="course-card">
      <h3>${escapeHtml(course.code)} - ${escapeHtml(course.name)}</h3>
      <p class="muted">${escapeHtml(course.description || "No description")}</p>
      <div class="course-meta">
        <span class="mini">${escapeHtml(course.department)}</span>
        <span class="mini">${course.credits} credits</span>
        <span class="mini">${course.enrolledCount}/${course.maxSeats} seats</span>
      </div>
      <div class="actions">
        ${registration ? `<button class="btn danger" data-drop="${registration.id}">Drop</button>` : mode === "registered" ? "" : `<button class="btn" data-register="${course.id}">Register</button>`}
      </div>
    </article>
  `;
}

async function facultyDashboard() {
  const data = await api("/api/faculty/dashboard");
  shell(
    "Faculty Dashboard",
    `Welcome, ${data.facultyName}${data.department ? ` (${data.department})` : ""}.`,
    `
      ${metrics([
        ["Current Workload", `${data.currentWorkload}${data.maxWorkload ? ` / ${data.maxWorkload}` : ""}`],
        ["Assigned Courses", data.totalAssignedCourses],
        ["Subjects Assigned", data.totalSubjectsAssigned],
        ["Classes This Week", data.totalClassesThisWeek],
        ["Registered Students", data.totalStudents]
      ])}
      <section class="grid two-col" style="margin-top:16px">
        <article class="panel">
          <h2>Upcoming Classes</h2>
          ${data.upcomingClasses && data.upcomingClasses.length
            ? table(
              ["Day", "Period", "Subject", "Group", "Room"],
              data.upcomingClasses.map((item) => `<tr>
                <td>${escapeHtml(item.day)}</td>
                <td>P${item.period}</td>
                <td><strong>${escapeHtml(item.courseCode)}</strong><br><span class="muted">${escapeHtml(item.courseName)}</span></td>
                <td>${escapeHtml(item.groupName || "-")}</td>
                <td>${escapeHtml(item.roomNumber || "-")}</td>
              </tr>`)
            )
            : `<p class="muted">No upcoming classes found.</p>`}
        </article>
        <article class="panel">
          <h2>Latest Notifications</h2>
          ${data.notifications && data.notifications.length
            ? `<div class="grid">${data.notifications.map((item) => `
              <div class="notice">
                <strong>${escapeHtml(item.text)}</strong><br>
                <span class="muted">${escapeHtml(String(item.createdAt || "").slice(0, 19).replace("T", " "))}</span>
              </div>
            `).join("")}</div>`
            : `<p class="muted">No notifications yet.</p>`}
        </article>
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>Assigned Courses</h2>
        ${courseCards(data.assignedCourses, "faculty")}
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>Complete Weekly Timetable</h2>
        ${data.integratedTimetable && data.integratedTimetable.length
          ? renderTimetable(
            data.integratedTimetable,
            data.integratedDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
            data.integratedPeriods || [1, 2, 3, 4, 5, 6, 7],
            { colorBySubject: true, showGroup: true, highlightCurrentDay: true }
          )
          : `<p class="muted">No published timetable slots found yet.</p>`}
      </section>
    `
  );
}

async function facultySubjects(subjectId = null) {
  const selectedSemester = String(state.edit.facultyTtSemester || "");
  if (!selectedSemester) {
    shell(
      "Assigned Subjects",
      "Subjects mapped to your faculty assignments.",
      `
        <section class="form-panel">
          <form id="faculty-subject-semester-filter" class="form-grid">
            ${select("semester", "Semester", [["", "Select Semester"], ...options.semester.map((item) => [item, item])], selectedSemester)}
          </form>
        </section>
        <section class="notice" style="margin-top:16px">Select a semester to view assigned subjects.</section>
      `
    );
    const filter = document.querySelector("#faculty-subject-semester-filter");
    if (filter) {
      filter.addEventListener("change", (event) => {
        const body = formObject(event.currentTarget);
        state.edit.facultyTtSemester = body.semester || "";
        render();
      });
    }
    return;
  }

  const semesterQuery = `?semester=${encodeURIComponent(selectedSemester)}`;
  const subjects = await api(`/api/faculty/subjects${semesterQuery}`);
  const details = subjectId ? await api(`/api/faculty/subjects/${subjectId}${semesterQuery}`) : null;
  shell(
    "Assigned Subjects",
    "Subjects mapped to your faculty assignments.",
    `
      <section class="form-panel">
        <form id="faculty-subject-semester-filter" class="form-grid">
          ${select("semester", "Semester", [["", "Select Semester"], ...options.semester.map((item) => [item, item])], selectedSemester)}
        </form>
      </section>
      ${subjects.length ? "" : `<section class="notice">No subjects assigned</section>`}
      <section class="panel" style="margin-top:16px">
        ${table(
          ["Course", "Assigned Group", "Semester", "Classes/Week", "Actions"],
          subjects.map((subject) => `<tr>
            <td><strong class="record-name">${escapeHtml(subject.courseName)}</strong><span class="record-meta">${escapeHtml(subject.courseCode)}</span></td>
            <td>${escapeHtml(subject.groupName)}${subject.yearName || subject.sectionName ? `<br><span class="record-meta">${escapeHtml(`${subject.yearName} ${subject.sectionName}`.trim())}</span>` : ""}</td>
            <td>${escapeHtml(subject.semester || "-")}</td>
            <td>${subject.classesPerWeek}</td>
            <td class="actions"><button class="btn secondary" data-route="/faculty/subjects/${subject.id}">View Details</button></td>
          </tr>`)
        )}
      </section>
      ${details ? `
        <section class="panel" style="margin-top:16px">
          <h2>Subject Details: ${escapeHtml(details.courseCode)} - ${escapeHtml(details.courseName)}</h2>
          ${metrics([
            ["Group", details.groupName || "-"],
            ["Type", details.courseType || "-"],
            ["Theory Hours", details.theoryHoursPerWeek || 0],
            ["Lab Hours", details.labHoursPerWeek || 0],
            ["Students", details.students ? details.students.length : 0]
          ])}
          <div style="margin-top:14px">
            ${table(
              ["Roll Number", "Name", "Email", "Registered"],
              (details.students || []).map((student) => `<tr>
                <td>${escapeHtml(student.rollNumber)}</td>
                <td>${escapeHtml(student.studentName)}</td>
                <td>${escapeHtml(student.email || "-")}</td>
                <td>${badge(student.registered ? "Yes" : "No")}</td>
              </tr>`)
            )}
          </div>
        </section>
      ` : ""}
    `
  );
  const filter = document.querySelector("#faculty-subject-semester-filter");
  if (filter) {
    filter.addEventListener("change", (event) => {
      const body = formObject(event.currentTarget);
      state.edit.facultyTtSemester = body.semester || "";
      state.edit.facultyStudentSubjectId = "";
      state.edit.facultyAttendanceSubjectId = "";
      render();
    });
  }
}

async function facultyStudents() {
  const selectedSemester = String(state.edit.facultyTtSemester || "");
  if (!selectedSemester) {
    shell(
      "Student List",
      "Students mapped to your assigned classes.",
      `
        <section class="form-panel">
          <form id="faculty-student-filter" class="form-grid">
            ${select("semester", "Semester", [["", "Select Semester"], ...options.semester.map((item) => [item, item])], selectedSemester)}
          </form>
        </section>
        <section class="notice" style="margin-top:16px">Select a semester to view students.</section>
      `
    );
    const filter = document.querySelector("#faculty-student-filter");
    if (filter) {
      filter.addEventListener("change", (event) => {
        const form = new FormData(event.currentTarget);
        state.edit.facultyTtSemester = form.get("semester") || "";
        render();
      });
    }
    return;
  }
  const semesterQuery = selectedSemester ? `?semester=${encodeURIComponent(selectedSemester)}` : "";
  const subjects = await api(`/api/faculty/subjects${semesterQuery}`);
  const selected = state.edit.facultyStudentSubjectId || (subjects[0] ? String(subjects[0].id) : "");
  const path = selected
    ? `/api/faculty/students?subjectId=${selected}${selectedSemester ? `&semester=${encodeURIComponent(selectedSemester)}` : ""}`
    : `/api/faculty/students${semesterQuery}`;
  const rows = subjects.length ? await api(path) : [];
  shell(
    "Student List",
    "Students mapped to your assigned classes.",
    `
      <section class="form-panel">
        <form id="faculty-student-filter" class="form-grid">
          ${select("semester", "Semester", [["", "Select Semester"], ...options.semester.map((item) => [item, item])], selectedSemester)}
          ${select("subjectId", "Subject", subjects.map((subject) => [subject.id, `${subject.courseCode} - ${subject.groupName}`]), selected, false)}
        </form>
      </section>
      <section class="panel" style="margin-top:16px">
        ${table(
          ["Course", "Group", "Roll Number", "Name", "Email"],
          rows.map((row) => `<tr>
            <td>${escapeHtml(row.courseCode)}<br><span class="muted">${escapeHtml(row.courseName)}</span></td>
            <td>${escapeHtml(row.groupName)}</td>
            <td>${escapeHtml(row.rollNumber)}</td>
            <td>${escapeHtml(row.studentName)}</td>
            <td>${escapeHtml(row.email || "-")}</td>
          </tr>`)
        )}
      </section>
    `
  );

  const filter = document.querySelector("#faculty-student-filter");
  if (filter) {
    filter.addEventListener("change", (event) => {
      const form = new FormData(event.currentTarget);
      state.edit.facultyTtSemester = form.get("semester") || "";
      state.edit.facultyStudentSubjectId = form.get("subjectId");
      render();
    });
  }
}

async function facultyAttendance() {
  const selectedSemester = String(state.edit.facultyTtSemester || "");
  if (!selectedSemester) {
    shell(
      "Attendance",
      "View students and record attendance for today's conducted class.",
      `
        <section class="form-panel">
          <form id="attendance-filter-form" class="form-grid">
            ${select("semester", "Semester", [["", "Select Semester"], ...options.semester.map((item) => [item, item])], selectedSemester)}
          </form>
        </section>
        <section class="notice" style="margin-top:16px">Select a semester to mark attendance.</section>
      `
    );
    const filter = document.querySelector("#attendance-filter-form");
    if (filter) {
      filter.addEventListener("change", (event) => {
        const form = formObject(event.currentTarget);
        state.edit.facultyTtSemester = form.semester || "";
        render();
      });
    }
    return;
  }
  const semesterQuery = selectedSemester ? `?semester=${encodeURIComponent(selectedSemester)}` : "";
  const subjects = await api(`/api/faculty/subjects${semesterQuery}`);
  if (!subjects.length) {
    shell("Attendance", "Mark and review attendance records.", `<section class="notice">${selectedSemester ? "No published timetable subjects found for selected semester." : "No assigned subjects found."}</section>`);
    return;
  }

  const today = todayLocalDate();
  const subjectId = Number(state.edit.facultyAttendanceSubjectId || subjects[0].id);
  const date = today;
  const [attendanceData, history] = await Promise.all([
    api(`/api/faculty/attendance?subjectId=${subjectId}&date=${date}${selectedSemester ? `&semester=${encodeURIComponent(selectedSemester)}` : ""}`),
    api(`/api/faculty/attendance/history?subjectId=${subjectId}${selectedSemester ? `&semester=${encodeURIComponent(selectedSemester)}` : ""}`)
  ]);
  const canSaveAttendance = Boolean(attendanceData.canMarkStudentAttendance);
  const classStatus = attendanceData.classAttendanceStatus || "Not Marked";
  const classStatusMessage = attendanceData.classAttendanceMessage || "Mark class status in timetable first.";
  const classStatusType = classStatus === "Absent" ? "error" : "";

  shell(
    "Attendance",
    "View students and record attendance for today's conducted class.",
    `
      <section class="form-panel">
        <form id="attendance-filter-form" class="form-grid">
          ${select("semester", "Semester", [["", "Select Semester"], ...options.semester.map((item) => [item, item])], selectedSemester)}
          ${select("subjectId", "Subject", subjects.map((subject) => [subject.id, `${subject.courseCode} - ${subject.groupName}`]), subjectId)}
          <div class="field">
            <label>Date</label>
            <input value="${escapeHtml(date)}" disabled>
          </div>
        </form>
      </section>
      <section class="panel" style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <strong>Class Status:</strong> ${badge(classStatus)}
        </div>
        <div class="notice ${classStatusType}" style="margin-bottom:12px">${escapeHtml(classStatusMessage)}</div>
        ${flashHtml("faculty-attendance")}
        <h2>Student Roster and Attendance</h2>
        <form id="attendance-form">
          ${table(
            ["Roll Number", "Name", "Email", "Status"],
            (attendanceData.students || []).map((student) => `<tr data-attendance-row="${student.id}">
              <td>${escapeHtml(student.rollNumber)}</td>
              <td>${escapeHtml(student.studentName)}</td>
              <td>${escapeHtml(student.email || "-")}</td>
              <td>
                <select name="status-${student.id}" ${canSaveAttendance ? "" : "disabled"}>
                  <option value="" ${student.status ? "" : "selected"}>Not Marked</option>
                  <option value="Present" ${student.status === "Present" ? "selected" : ""}>Present</option>
                  <option value="Absent" ${student.status === "Absent" ? "selected" : ""}>Absent</option>
                </select>
              </td>
            </tr>`)
          )}
          <div class="actions" style="margin-top:14px">
            <button class="btn" type="submit" ${canSaveAttendance ? "" : "disabled"}>Save Attendance</button>
          </div>
        </form>
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>Past Attendance Records</h2>
        ${table(
          ["Date", "Roll Number", "Name", "Status"],
          history.map((item) => `<tr>
            <td>${escapeHtml(item.date)}</td>
            <td>${escapeHtml(item.rollNumber)}</td>
            <td>${escapeHtml(item.studentName)}</td>
            <td>${badge(item.status)}</td>
          </tr>`)
        )}
      </section>
    `
  );

  const filterForm = document.querySelector("#attendance-filter-form");
  if (filterForm) {
    filterForm.addEventListener("change", (event) => {
      const form = formObject(event.currentTarget);
      state.edit.facultyTtSemester = form.semester || "";
      state.edit.facultyAttendanceSubjectId = form.subjectId;
      render();
    });
  }

  const attendanceForm = document.querySelector("#attendance-form");
  if (attendanceForm) {
    attendanceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const rows = Array.from(document.querySelectorAll("[data-attendance-row]"));
      const records = rows.map((row) => {
        const studentRecordId = Number(row.dataset.attendanceRow);
        const status = attendanceForm.querySelector(`[name="status-${studentRecordId}"]`).value;
        return { studentRecordId, status };
      }).filter((row) => ["Present", "Absent"].includes(row.status));
      if (!records.length) {
        setFlash("Select Present/Absent for at least one student.", "error", "faculty-attendance");
        render();
        return;
      }
      await api("/api/faculty/attendance", {
        method: "POST",
        body: JSON.stringify({ subjectId, date, semester: selectedSemester, records })
      });
      setFlash("Student attendance saved.", "success", "faculty-attendance");
      render();
    });
  }
}

function facultyTimetableGrid(schedule, days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], periods = [1, 2, 3, 4, 5, 6, 7], selectedDate = "") {
  const visibleDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].filter((day) => (days || []).includes(day) || day === "Saturday");
  const slotMap = new Map((schedule || []).map((slot) => [`${slot.day}|${slot.period}`, slot]));
  const currentDay = new Date().toLocaleDateString("en-US", { weekday: "long" });
  return table(
    ["Day", ...periods.map((period) => `P${period}`)],
    visibleDays.map((day) => `
      <tr class="${day === currentDay ? "timetable-day-current" : "timetable-day-disabled"}">
        <td><strong>${day}</strong></td>
        ${periods.map((period) => {
          const slot = slotMap.get(`${day}|${period}`);
          if (!slot) return `<td><span class="empty">Free</span></td>`;
          const slotState = slot.slotState || slot.attendanceStatus || "Not Marked";
          const slotStateClass = slotState.toLowerCase().replaceAll(" ", "-");
          const stateBadge = badge(slotState);
          const replacement = slot.replacementFacultyName
            ? `<div class="muted">Replacement: ${escapeHtml(slot.replacementFacultyName)}</div>`
            : "";
          const replacementTag = slot.isReplacementSession && slot.absentFacultyName
            ? `<div class="muted" style="margin-top:4px">Covering for: ${escapeHtml(slot.absentFacultyName)}</div>`
            : "";
          const canMarkForSelectedDate = slot.day === currentDay;
          const canMark = canMarkForSelectedDate && slot.canMarkAttendance !== false;
          const locked = Boolean(slot.locked) || slot.canMarkAttendance === false;
          const dayHint = canMarkForSelectedDate ? "" : `<div class="notice" style="margin-top:8px">Only ${escapeHtml(currentDay)} is interactive.</div>`;
          const showActions = canMarkForSelectedDate && !locked;
          return `<td>
            <div class="slot slot-state-${slotStateClass}" style="background:${subjectColor(slot.courseCode)}">
              <strong>${escapeHtml(slot.courseCode)}</strong>${sessionShortLabel(slot) ? ` <span style="display:inline-block; margin-left:6px; padding:1px 6px; border:1px solid #6b7280; border-radius:999px; font-size:11px; font-weight:700; background:#fff;">${escapeHtml(sessionShortLabel(slot))}</span>` : ""}<br>
              ${escapeHtml(slot.courseName)}<br>
              ${escapeHtml(slot.groupName || "")}<br>
              ${escapeHtml(slot.roomNumber || "")}<br>
              <span class="muted">${escapeHtml(slot.timeSlot || "")}</span>
              ${replacement}
              ${replacementTag}
              <div style="margin-top:6px">${stateBadge}</div>
              ${showActions ? `<div class="actions" style="margin-top:8px">
                <button class="btn success" data-mark-faculty-attendance="${slot.id}" data-mark-status="Present" data-mark-date="${escapeHtml(selectedDate)}" ${canMark ? "" : "disabled"}>Mark Present</button>
                <button class="btn danger" data-mark-faculty-attendance="${slot.id}" data-mark-status="Absent" data-mark-date="${escapeHtml(selectedDate)}" ${canMark ? "" : "disabled"}>Mark Absent</button>
              </div>` : ""}
              ${locked ? `<div class="muted" style="margin-top:6px">${escapeHtml(slot.lockReason || "Slot locked after marking.")}</div>` : ""}
              ${!canMarkForSelectedDate ? dayHint : ""}
            </div>
          </td>`;
        }).join("")}
      </tr>
    `)
  );
}

async function adminFacultyAlerts() {
  const data = await api("/api/admin/faculty-absent-alerts");
  const alerts = data.alerts || [];
  const pendingAlerts = alerts.filter((item) => String(item.status || "").toLowerCase() === "pending");
  const resolvedAlerts = alerts.filter((item) => String(item.status || "").toLowerCase() === "resolved");
  shell(
    "Faculty Absence Alerts",
    "Only teachers marked absent are listed here for admin action.",
    `
      <section class="panel">
        <div class="muted">Action queue for pending absent-faculty alerts.</div>
      </section>
      ${flashHtml("admin-alerts")}
      <section class="panel" style="margin-top:16px">
        <div class="muted" style="margin-bottom:10px">
          Pending alerts: ${pendingAlerts.length}
        </div>
        ${table(
          ["Faculty", "Course", "Group", "Slot", "Status", "Action"],
          pendingAlerts.map((item) => `
            <tr>
              <td>
                ${escapeHtml(item.facultyName)}
                ${item.originalFacultyName && item.originalFacultyName !== item.facultyName ? `<br><span class="muted">Original: ${escapeHtml(item.originalFacultyName)}</span>` : ""}
              </td>
              <td><strong>${escapeHtml(item.courseCode)}</strong><br><span class="muted">${escapeHtml(item.courseName)}</span></td>
              <td>${escapeHtml(item.groupName)}</td>
              <td>${escapeHtml(item.day)} P${item.period}<br><span class="muted">${escapeHtml(item.timeSlot || "")}</span></td>
              <td>${badge("Absent")}</td>
              <td class="actions">
                <select id="replace-select-${item.alertId || item.attendanceId}">
                  <option value="">Select substitute faculty</option>
                  ${(item.replacementCandidates || []).slice(0, 3).map((candidate) => `<option value="${candidate.facultyId}">Recommended: ${escapeHtml(candidate.facultyName)} (${escapeHtml(candidate.department)}) | ${candidate.workload}/${candidate.maxWorkload || 0} load</option>`).join("")}
                  ${(item.replacementCandidates || []).length > 3 ? `<option disabled>----------------</option>` : ""}
                  ${(item.replacementCandidates || []).slice(3).map((candidate) => `<option value="${candidate.facultyId}">${escapeHtml(candidate.facultyName)} (${escapeHtml(candidate.department)})${candidate.hasSameSubject ? " - same subject" : candidate.sameDepartment ? " - same department" : ""} | ${candidate.workload}/${candidate.maxWorkload || 0} load</option>`).join("")}
                </select>
                ${(item.replacementCandidates || []).length === 0 ? `<div class="muted" style="margin-top:6px">No eligible substitute available (same department + subject expertise + free slot).</div>` : ""}
                <button class="btn" data-resolve-alert="${item.alertId || item.attendanceId}" data-alert-action="replacement">Assign Substitute</button>
                <button class="btn secondary" data-resolve-alert="${item.alertId || item.attendanceId}" data-alert-action="free">Leave Free</button>
              </td>
            </tr>
          `)
        )}
      </section>
      <section class="panel" style="margin-top:16px">
        <h2>Resolved Alerts</h2>
        ${table(
          ["Faculty", "Course", "Group", "Slot", "Status", "Details"],
          resolvedAlerts.map((item) => `
            <tr>
              <td>${escapeHtml(item.facultyName)}</td>
              <td><strong>${escapeHtml(item.courseCode)}</strong><br><span class="muted">${escapeHtml(item.courseName)}</span></td>
              <td>${escapeHtml(item.groupName || "-")}</td>
              <td>${escapeHtml(item.day)} P${item.period}<br><span class="muted">${escapeHtml(item.timeSlot || "")}</span></td>
              <td>${badge(item.resolutionType || "Resolved")}</td>
              <td>${item.resolutionType === "Substituted" && item.replacementFacultyName
                ? `<span class="muted">Substituted: ${escapeHtml(item.replacementFacultyName)}</span>`
                : `<span class="muted">Leave Free</span>`}</td>
            </tr>
          `)
        )}
      </section>
    `
  );
}

async function timetablePage(role) {
  if (role === "admin") {
    const bootstrap = await api("/api/bootstrap");
    let publishedRows = [];
    try {
      publishedRows = await api("/api/timetable-published-all");
    } catch (_error) {
      publishedRows = [];
    }
    const groups = bootstrap.groups || [];
    const departments = Array.from(new Set(groups.map((group) => group.department || "").filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const programs = Array.from(new Set(groups.map((group) => normalizeProgramName(group.program || "B.Tech")).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    let selectedDept = state.edit.adminTtDept || "";
    if (selectedDept && !departments.includes(selectedDept)) selectedDept = "";
    let selectedProgram = normalizeProgramFilter(state.edit.adminTtProgram || "");
    if (selectedProgram && !programs.includes(selectedProgram)) selectedProgram = "";
    const semesterOptions = Array.from(new Set((bootstrap.groups || [])
      .filter((group) => (!selectedDept || group.department === selectedDept) && (!selectedProgram || normalizeProgramName(group.program || "B.Tech") === selectedProgram))
      .map((group) => groupSemesterValue(group))
      .filter(Boolean))).sort((a, b) => a.localeCompare(b));
    let selectedSemester = state.edit.adminTtSemester || "";
    if (selectedSemester && !semesterOptions.includes(selectedSemester)) selectedSemester = "";
    const sectionOptions = Array.from(new Set((bootstrap.groups || [])
      .filter((group) => (!selectedDept || group.department === selectedDept) && (!selectedProgram || normalizeProgramName(group.program || "B.Tech") === selectedProgram) && (!selectedSemester || groupSemesterValue(group) === selectedSemester))
      .map((group) => group.sectionName || "")
      .filter(Boolean))).sort((a, b) => a.localeCompare(b));
    let selectedSection = state.edit.adminTtSection || "";
    if (selectedSection && !sectionOptions.includes(selectedSection)) selectedSection = "";
    const selectedSaturdayMode = state.edit.adminTtSaturdayMode || (selectedProgram === "M.Tech" ? "workday" : "holiday");
    const selectedSaturdayCopyDay = state.edit.adminTtSaturdayCopyDay || "Monday";
    shell(
      "Timetable",
      "Generate and publish a weekly timetable for one exact group (Department -> Semester -> Section / Stream).",
      `
        ${flashHtml("timetable")}
        <section class="form-panel timetable-builder">
          <form id="generate-form" class="timetable-generate">
            ${select("department", "Department", [["", "Select Department"], ...departments.map((item) => [item, item])], selectedDept)}
            ${select("program", "Program", [["", "Select Program"], ...programs.map((item) => [item, item])], selectedProgram)}
            ${select("semester", "Semester", [["", "Select Semester"], ...semesterOptions.map((item) => [item, item])], selectedSemester)}
            ${select("sectionName", "Section / Stream", [["", "Select Section / Stream"], ...sectionOptions.map((item) => [item, item])], selectedSection)}
            ${select("saturdayMode", "Saturday Mode", [["holiday", "Holiday"], ["workday", "Working Day"], ["copy", "Copy from another day"]], selectedSaturdayMode)}
            ${select("saturdayCopyFromDay", "Copy Day", [["Monday", "Monday"], ["Tuesday", "Tuesday"], ["Wednesday", "Wednesday"], ["Thursday", "Thursday"], ["Friday", "Friday"]], selectedSaturdayCopyDay)}
            <button class="btn" type="submit">Generate Timetable</button>
          </form>
        </section>
        <section id="timetable-result">${state.timetableResult ? timetableOptions(state.timetableResult) : ""}</section>
        <section style="margin-top:16px">${renderPublishedTimetablesAdmin(publishedRows)}</section>
      `
    );
    const generateForm = document.querySelector("#generate-form");
    generateForm.addEventListener("change", (event) => {
      const body = formObject(event.currentTarget);
      const changed = event.target && event.target.name ? String(event.target.name) : "";
      if (changed === "department") {
        state.edit.adminTtDept = body.department || "";
        state.edit.adminTtProgram = normalizeProgramFilter(body.program || "");
        state.edit.adminTtSemester = "";
        state.edit.adminTtSection = "";
      } else if (changed === "program") {
        state.edit.adminTtDept = body.department || "";
        state.edit.adminTtProgram = normalizeProgramFilter(body.program || "");
        state.edit.adminTtSemester = "";
        state.edit.adminTtSection = "";
      } else if (changed === "semester") {
        state.edit.adminTtDept = body.department || "";
        state.edit.adminTtProgram = normalizeProgramFilter(body.program || "");
        state.edit.adminTtSemester = body.semester || "";
        state.edit.adminTtSection = "";
      } else {
        state.edit.adminTtDept = body.department || "";
        state.edit.adminTtProgram = normalizeProgramFilter(body.program || "");
        state.edit.adminTtSemester = body.semester || "";
        state.edit.adminTtSection = body.sectionName || "";
      }
      state.edit.adminTtSaturdayMode = body.saturdayMode || "holiday";
      state.edit.adminTtSaturdayCopyDay = body.saturdayCopyFromDay || "Monday";
      render();
    });
    generateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = formObject(event.currentTarget);
      if (!body.department || !body.program || !body.semester || !body.sectionName) {
        setFlash("Select Department, Program, Semester and Section / Stream before generating timetable.", "error", "timetable");
        render();
        return;
      }
      const group = (bootstrap.groups || []).find((item) =>
        String(item.department || "") === String(body.department || "") &&
        normalizeProgramName(item.program || "B.Tech") === normalizeProgramName(body.program || "") &&
        groupSemesterValue(item) === String(body.semester || "") &&
        String(item.sectionName || "") === String(body.sectionName || "")
      );
      if (!group) {
        setFlash("Select Department, Semester and Section / Stream for a valid group.", "error", "timetable");
        render();
        return;
      }
      try {
        state.timetableResult = await api("/api/timetable/generate", {
          method: "POST",
          body: JSON.stringify({
            department_id: String(body.department || ""),
            program: normalizeProgramName(body.program || ""),
            groupId: Number(group.id),
            groupName: group.label,
            semester: String(body.semester || ""),
            generationNonce: `${Date.now()}-${Math.random()}`,
            strictMode: true,
            saturdayMode: body.saturdayMode || "holiday",
            saturdayCopyFromDay: body.saturdayCopyFromDay || "Monday"
          })
        });
        const resultDays = Array.isArray(state.timetableResult.days) ? state.timetableResult.days : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const resultPeriods = Array.isArray(state.timetableResult.periods) ? state.timetableResult.periods : [1, 2, 3, 4, 5, 6, 7];
        if (state.timetableResult.options && typeof state.timetableResult.options === "object") {
          for (const key of ["A", "B", "C"]) {
            const option = state.timetableResult.options[key];
            if (!option || !Array.isArray(option.schedule)) continue;
            option.schedule = compactScheduleForTrailingFreeOnly(option.schedule, resultDays, resultPeriods);
          }
        }
        state.timetablePublishedOption = null;
        state.timetableOption = state.timetableResult.recommendedOption || "A";
        const best = state.timetableResult.options[state.timetableOption] || { schedule: [], unscheduled: [] };
        if (!best.schedule.length) {
          setFlash("Timetable generated but no slots could be scheduled. Check faculty/course/group mapping.", "error", "timetable");
        } else if (best.unscheduled.length || (state.timetableResult.missingFaculty || []).length) {
          setFlash("Timetable generated with issues. Review warnings before publishing.", "error", "timetable");
        } else {
          setFlash("Timetable generated successfully. Best option is selected.", "success", "timetable");
        }
      } catch (error) {
        state.timetableResult = null;
        setFlash(error.message || "Could not generate timetable.", "error", "timetable");
      }
      render();
    });
    return;
  }

  if (role === "faculty") {
    const selectedDate = todayLocalDate();
    const selectedSemester = state.edit.facultyTtSemester || "";
    const selectedProgram = normalizeProgramFilter(state.edit.facultyTtProgram || "");
    const data = selectedSemester
      ? await api(`/api/my-timetable/faculty?date=${selectedDate}&semester=${encodeURIComponent(selectedSemester)}${selectedProgram ? `&program=${encodeURIComponent(selectedProgram)}` : ""}`)
      : { message: "Select semester to view timetable.", schedule: [], days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], periods: [1, 2, 3, 4, 5, 6, 7], facultyName: "My Timetable" };
    shell(
      "Timetable",
      data.message || (data.facultyName || "My Timetable"),
      `
        <section class="form-panel">
          <form id="faculty-tt-filter" class="form-grid">
            ${select("program", "Program", [["", "Select Program"], ...options.program.map((item) => [item, item])], selectedProgram)}
            ${select("semester", "Semester", [["", "Select Semester"], ...options.semester.map((item) => [item, item])], selectedSemester)}
          </form>
        </section>
        <section class="panel">
          <div class="muted">Today: ${escapeHtml(data.date || selectedDate)} (${escapeHtml(new Date(selectedDate).toLocaleDateString("en-US", { weekday: "long" }))})</div>
        </section>
        ${flashHtml("faculty-timetable")}
        <section class="panel" style="margin-top:16px">${facultyTimetableGrid(data.schedule, data.days, data.periods, data.date || selectedDate)}</section>
      `
    );
    const facultyFilterForm = document.querySelector("#faculty-tt-filter");
    if (facultyFilterForm) {
      facultyFilterForm.addEventListener("change", (event) => {
        const body = formObject(event.currentTarget);
        state.edit.facultyTtProgram = normalizeProgramFilter(body.program || "");
        state.edit.facultyTtSemester = body.semester || "";
        render();
      });
    }
    return;
  }

  const bootstrap = await api("/api/bootstrap");
  const groups = bootstrap.groups || [];
  const departments = Array.from(new Set(groups.map((group) => group.department || "").filter(Boolean))).sort((a, b) => a.localeCompare(b));
  let selectedDept = state.edit.studentTtDept || "";
  if (selectedDept && !departments.includes(selectedDept)) selectedDept = "";
  const semesterOptions = Array.from(new Set((bootstrap.groups || [])
    .filter((group) => !selectedDept || group.department === selectedDept)
    .map((group) => groupSemesterValue(group))
    .filter(Boolean))).sort((a, b) => a.localeCompare(b));
  let selectedSemester = state.edit.studentTtSemester || "";
  if (selectedSemester && !semesterOptions.includes(selectedSemester)) selectedSemester = "";
  const sectionOptions = Array.from(new Set((bootstrap.groups || [])
    .filter((group) => (!selectedDept || group.department === selectedDept) && (!selectedSemester || groupSemesterValue(group) === selectedSemester))
    .map((group) => group.sectionName || "")
    .filter(Boolean))).sort((a, b) => a.localeCompare(b));
  let selectedSection = state.edit.studentTtSection || "";
  if (selectedSection && !sectionOptions.includes(selectedSection)) selectedSection = "";
  const canFetch = Boolean(selectedDept && selectedSemester && selectedSection);
  const data = canFetch
    ? await api(`/api/timetable/group-view?department=${encodeURIComponent(selectedDept)}&semester=${encodeURIComponent(selectedSemester)}&sectionName=${encodeURIComponent(selectedSection)}`)
    : { message: "Select Department, Semester and Section / Stream to view timetable.", schedule: [], days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], periods: [1, 2, 3, 4, 5, 6, 7] };
  shell(
    "Timetable",
    data.message || (data.groupName ? data.groupName : "Published timetable"),
    `
      <section class="form-panel">
        <form id="student-tt-filter" class="form-grid">
          ${select("department", "Department", [["", "Select Department"], ...departments.map((item) => [item, item])], selectedDept)}
          ${select("semester", "Semester", [["", "Select Semester"], ...semesterOptions.map((item) => [item, item])], selectedSemester)}
          ${select("sectionName", "Section / Stream", [["", "Select Section / Stream"], ...sectionOptions.map((item) => [item, item])], selectedSection)}
        </form>
      </section>
      <section class="panel" style="margin-top:16px">${renderTimetable(data.schedule, data.days, data.periods, {
        highlightCurrentDay: false,
        colorBySubject: false,
        showGroup: false
      })}</section>
    `
  );
  const filterForm = document.querySelector("#student-tt-filter");
  if (filterForm) {
    filterForm.addEventListener("change", (event) => {
      const body = formObject(event.currentTarget);
      const changed = event.target && event.target.name ? String(event.target.name) : "";
      if (changed === "department") {
        state.edit.studentTtDept = body.department || "";
        state.edit.studentTtSemester = "";
        state.edit.studentTtSection = "";
      } else if (changed === "semester") {
        state.edit.studentTtDept = body.department || "";
        state.edit.studentTtSemester = body.semester || "";
        state.edit.studentTtSection = "";
      } else {
        state.edit.studentTtDept = body.department || "";
        state.edit.studentTtSemester = body.semester || "";
        state.edit.studentTtSection = body.sectionName || "";
      }
      render();
    });
  }
}

function renderPublishedTimetablesAdmin(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return `<section class="panel"><h2>Published Timetables</h2><p class="muted">No timetables published yet.</p></section>`;
  }
  return `
    <section class="panel">
      <h2>Published Timetables (${list.length})</h2>
      <div class="muted" style="margin-bottom:8px">All published groups across semesters are listed below.</div>
      ${list.map((row, index) => {
    const heading = `${row.groupName || "Unknown Group"}${row.department ? ` | ${row.department}` : ""}${row.semester ? ` | Sem ${row.semester}` : ""}`;
    const publishedAt = row.publishedAt ? String(row.publishedAt).replace("T", " ").slice(0, 19) : "-";
    return `
          <details ${index === 0 ? "open" : ""} style="margin:10px 0; border:1px solid #e5e7eb; border-radius:10px; padding:8px 10px; background:#fff">
            <summary style="cursor:pointer; font-weight:700">${escapeHtml(heading)}</summary>
            <div class="muted" style="margin:6px 0 10px 0">
              Published: ${escapeHtml(publishedAt)} | Teaching: ${Number(row.teachingSlots || 0)} | Free: ${Number(row.freeSlots || 0)} | Total: ${Number(row.totalSlots || 0)}
            </div>
            ${renderTimetable(row.schedule || [], ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], [1, 2, 3, 4, 5, 6, 7])}
          </details>
        `;
  }).join("")}
    </section>
  `;
}

function timetableOptions(result) {
  const selected = state.timetableOption || "A";
  const option = result.options[selected];
  const recommended = result.recommendedOption || "A";
  const saturdaySlots = (option.schedule || []).filter((slot) => slot.day === "Saturday");
  const saturdayFree = saturdaySlots.filter((slot) => slot.isFreeClass).length;
  const saturdayTeaching = saturdaySlots.length - saturdayFree;
  const hasIssues = ((result.missingFaculty || []).length > 0) || ((option.unscheduled || []).length > 0);
  const conflictCount = Number((option.metrics && option.metrics.conflictCount) || 0);
  const hasConflicts = conflictCount > 0;
  const missingFaculty = result.missingFaculty && result.missingFaculty.length
    ? `<section class="notice error timetable-notice">
        ${result.missingFaculty.map((item) => `<div><strong>${escapeHtml(item.courseCode)}</strong> - ${escapeHtml(item.courseName)}: ${escapeHtml(item.reason)}</div>`).join("")}
      </section>`
    : "";
  return `
    <article class="panel timetable-result">
      ${state.timetablePublishedOption ? `<section class="notice" style="margin-bottom:10px"><strong>Published:</strong> Option ${escapeHtml(state.timetablePublishedOption)} has been published successfully.</section>` : ""}
      <div class="timetable-actions">
        <div class="option-tabs">
          ${["A", "B", "C"].map((key) => {
            const item = result.options[key] || {};
            const badge = key === recommended ? " - Best" : "";
            return `<button class="${selected === key ? "active" : ""}" data-option="${key}">Option ${key}${badge} (Score ${item.score || 0})</button>`;
          }).join("")}
        </div>
        <button class="btn" data-publish="${selected}">${selected === recommended ? `Publish Best Option ${selected}` : `Publish Option ${selected}`}</button>
      </div>
      <section class="panel" style="margin-bottom:12px">
        <strong>Selected Option ${selected}</strong>
        <div class="muted">Score: ${option.score || 0} | Unscheduled: ${(option.metrics && option.metrics.unscheduledCount) || 0} | Conflicts: ${conflictCount}</div>
        <div class="muted">Saturday: ${saturdaySlots.length ? `${saturdayTeaching} class slot(s), ${saturdayFree} free slot(s)` : "Not configured"}</div>
        <div class="muted">${hasIssues || hasConflicts ? "Status: Needs attention before publish" : "Status: Ready to publish"}</div>
      </section>
      ${missingFaculty}
      ${option.unscheduled.length ? `<div class="notice timetable-notice">
        ${option.unscheduled.map((item) => `<div><strong>${escapeHtml(item.courseCode)}</strong> - ${escapeHtml(item.courseName)}: ${escapeHtml(item.reason)}</div>`).join("")}
      </div>` : ""}
      <div class="muted" style="margin:6px 0 10px 0;"><strong>Legend:</strong> <span style="display:inline-block; padding:1px 6px; border:1px solid #9ca3af; border-radius:999px; font-size:12px; font-weight:700;">TH</span> Theory &nbsp; <span style="display:inline-block; padding:1px 6px; border:1px solid #9ca3af; border-radius:999px; font-size:12px; font-weight:700;">LB</span> Lab</div>
      ${renderTimetable(option.schedule, result.days, result.periods)}
    </article>
  `;
}

function compactScheduleForTrailingFreeOnly(schedule, days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], periods = [1, 2, 3, 4, 5, 6, 7]) {
  const input = Array.isArray(schedule) ? schedule : [];
  const byDay = new Map(days.map((day) => [day, []]));
  const passthrough = [];

  for (const slot of input) {
    if (!slot || slot.isFreeClass) continue;
    const day = String(slot.day || "");
    if (!byDay.has(day)) {
      passthrough.push({ ...slot });
      continue;
    }
    byDay.get(day).push({ ...slot });
  }

  const output = [];
  for (const day of days) {
    const slots = (byDay.get(day) || []).sort((a, b) => Number(a.period || 0) - Number(b.period || 0));
    for (let index = 0; index < slots.length; index += 1) {
      const period = periods[index] || (index + 1);
      output.push({
        ...slots[index],
        day,
        period,
        timeSlot: `P${period}`
      });
    }
  }
  return [...output, ...passthrough];
}

function subjectColor(code) {
  let hash = 0;
  for (const ch of String(code || "")) hash = (hash << 5) - hash + ch.charCodeAt(0);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 72% 92%)`;
}

function dayNameFromDateInput(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", { weekday: "long" });
}

function sessionShortLabel(slot) {
  const sessionKind = String((slot && slot.sessionKind) || "").trim().toLowerCase();
  if (sessionKind === "theory") return "TH";
  if (sessionKind === "lab") return "LB";
  const courseType = String((slot && slot.courseType) || "").trim().toLowerCase();
  if (courseType.includes("theory") && courseType.includes("lab")) return "TH/LB";
  if (courseType.includes("lab")) return "LB";
  if (courseType.includes("theory")) return "TH";
  return "";
}

function formatConflictDiagnosticsMessage(data) {
  const list = Array.isArray(data && data.conflicts) ? data.conflicts : [];
  if (!list.length) return "";
  const top = list.slice(0, 6).map((item) => {
    const type = String(item.type || "conflict");
    const day = String(item.day || "-");
    const period = Number(item.period || 0);
    const faculty = item.facultyId ? ` faculty:${item.facultyId}` : "";
    const room = item.roomId ? ` room:${item.roomId}` : "";
    const source = item.sourceGroup ? ` source:${item.sourceGroup}` : "";
    return `${type} ${day} P${period}${faculty}${room}${source}`;
  });
  const more = list.length > top.length ? ` (+${list.length - top.length} more)` : "";
  return `Diagnostics: ${top.join(" | ")}${more}`;
}

function renderTimetable(
  schedule,
  days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  periods = [1, 2, 3, 4, 5, 6, 7],
  options = {}
) {
  const visibleDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].filter((day) => (days || []).includes(day) || day === "Saturday");
  const slotMap = new Map((schedule || []).map((slot) => [`${slot.day}|${slot.period}`, slot]));
  const currentDay = new Date().toLocaleDateString("en-US", { weekday: "long" });
  return table(
    ["Day", ...periods.map((period) => `P${period}`)],
    visibleDays.map((day) => `
      <tr class="${options.highlightCurrentDay && day === currentDay ? "timetable-day-current" : ""}">
        <td><strong>${day}</strong></td>
        ${periods.map((period) => {
          const slot = slotMap.get(`${day}|${period}`);
          const style = options.colorBySubject && slot ? ` style="background:${subjectColor(slot.courseCode)}"` : "";
          const groupLine = options.showGroup && slot && slot.groupName ? `<br>${escapeHtml(slot.groupName)}` : "";
          const shortType = slot ? sessionShortLabel(slot) : "";
          const shortTypeBadge = shortType ? ` <span style="display:inline-block; margin-left:6px; padding:1px 6px; border:1px solid #6b7280; border-radius:999px; font-size:11px; font-weight:700; background:#fff;">${escapeHtml(shortType)}</span>` : "";
          return `<td>${slot ? `<div class="slot"${style}><strong>${escapeHtml(slot.courseCode)}</strong>${shortTypeBadge}<br>${escapeHtml(slot.courseName)}${groupLine}<br>${escapeHtml(slot.roomNumber || "")}</div>` : `<span class="empty">Free</span>`}</td>`;
        }).join("")}
      </tr>
    `)
  );
}

function placeholder(title, text) {
  shell(title, text, `<section class="panel"><p class="muted">${text}</p></section>`);
}

async function reports() {
  const [students, faculty, courses] = await Promise.all([
    api("/api/admin/students"),
    api("/api/admin/faculty"),
    api("/api/courses")
  ]);
  shell(
    "Reports",
    "Quick operational report for the current database.",
    `
      ${metrics([["Student Records", students.length], ["Faculty Records", faculty.length], ["Registration Courses", courses.length]])}
      <section class="panel" style="margin-top:16px">
        <h2>Course Capacity</h2>
        ${table(["Course", "Department", "Seats"], courses.map((course) => `
          <tr><td>${escapeHtml(course.code)} - ${escapeHtml(course.name)}</td><td>${escapeHtml(course.department)}</td><td>${course.enrolledCount}/${course.maxSeats}</td></tr>
        `))}
      </section>
    `
  );
}

async function profile(role) {
  if (role === "admin") {
    const data = await api("/api/admin/profile");
    shell(
      "Profile",
      "Your administrator account details.",
      `
        <section class="panel">
          ${table(["Field", "Value"], [
            `<tr><td>Admin ID</td><td>${escapeHtml(data.id)}</td></tr>`,
            `<tr><td>Name</td><td>${escapeHtml(data.name)}</td></tr>`,
            `<tr><td>Username</td><td>${escapeHtml(data.username)}</td></tr>`,
            `<tr><td>Email</td><td>${escapeHtml(data.email)}</td></tr>`,
            `<tr><td>Department</td><td>${escapeHtml(data.department)}</td></tr>`,
            `<tr><td>Role</td><td>${escapeHtml(data.role)}</td></tr>`,
            `<tr><td>Created At</td><td>${escapeHtml(String(data.createdAt || "").slice(0, 19).replace("T", " "))}</td></tr>`
          ])}
        </section>
      `
    );
    return;
  }

  if (role === "faculty") {
    const data = await api("/api/faculty/profile");
    shell(
      "Profile",
      "Your faculty account details.",
      `
        <section class="panel">
          ${table(["Field", "Value"], [
            `<tr><td>Name</td><td>${escapeHtml(data.facultyName)}</td></tr>`,
            `<tr><td>Faculty ID</td><td>${escapeHtml(data.facultyId)}</td></tr>`,
            `<tr><td>Email</td><td>${escapeHtml(data.email)}</td></tr>`,
            `<tr><td>Department</td><td>${escapeHtml(data.department)}</td></tr>`,
            `<tr><td>Max Workload</td><td>${escapeHtml(data.maxWorkload)}</td></tr>`
          ])}
        </section>
        <section class="form-panel" style="margin-top:16px">
          <h2>Update Profile</h2>
          <form id="faculty-profile-form" class="form-grid">
            ${input("email", "Email", data.email, "email")}
            ${input("password", "New Password (optional)", "", "password")}
            <div class="field" style="align-self:end">
              <button class="btn" type="submit">Save Changes</button>
            </div>
          </form>
        </section>
      `
    );

    const form = document.querySelector("#faculty-profile-form");
    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = formObject(event.currentTarget);
        await api("/api/faculty/profile", {
          method: "PUT",
          body: JSON.stringify({ email: body.email, password: body.password || undefined })
        });
        const current = await api("/api/auth/me");
        state.user = current;
        render();
      });
    }
    return;
  }

  shell(
    "Profile",
    "Your current signed-in account.",
    `<section class="panel">${table(["Name", "Username", "Email", "Role"], [`<tr><td>${escapeHtml(state.user.name)}</td><td>${escapeHtml(state.user.username)}</td><td>${escapeHtml(state.user.email)}</td><td>${escapeHtml(role)}</td></tr>`])}</section>`
  );
}

async function render() {
  state.page = window.location.pathname;
  syncRealtimeRefresh();
  const loginMatch = state.page.match(/^\/(admin|faculty|student)\/login$/);
  const facultySubjectMatch = state.page.match(/^\/faculty\/subjects\/(\d+)$/);

  if (state.page === "/") {
    if (state.user) {
      go(`/${state.user.role}/dashboard`);
      return;
    }
    home();
    return;
  }

  if (loginMatch) {
    if (state.user) {
      go(`/${state.user.role}/dashboard`);
      return;
    }
    login(loginMatch[1]);
    return;
  }

  if (!state.user) {
    if (state.page.startsWith("/faculty/")) {
      go("/faculty/login");
      return;
    }
    go("/");
    return;
  }

  if (!state.page.startsWith(`/${state.user.role}/`)) {
    go(`/${state.user.role}/dashboard`);
    return;
  }

  if (state.user.role === "admin") {
    try {
      const alertData = await api("/api/admin/faculty-absent-alerts?unresolved=true");
      state.adminAlertCount = (alertData.alerts || []).length;
    } catch (_error) {
      state.adminAlertCount = 0;
    }
  } else {
    state.adminAlertCount = 0;
  }

  try {
    if (state.page === "/admin/dashboard") return adminDashboard();
    if (state.page === "/admin/students") return adminStudentsPage();
    if (state.page === "/admin/faculty") return adminFacultyPage();
    if (state.page === "/admin/departments") return adminDepartmentsPage();
    if (state.page === "/admin/courses") return adminCourses();
    if (state.page === "/admin/groups") return go("/admin/departments");
    if (state.page === "/admin/rooms") return genericCrud(crudConfig("rooms"));
    if (state.page === "/admin/timetable") return timetablePage("admin");
    if (state.page === "/admin/faculty-alerts") return adminFacultyAlerts();
    if (state.page === "/admin/reports") return reports();
    if (state.page === "/admin/settings") return genericCrud(crudConfig("adminCourseRecords"));
    if (state.page === "/admin/profile") return profile("admin");

    if (state.page === "/faculty/dashboard") return facultyDashboard();
    if (state.page === "/faculty/subjects") return facultySubjects();
    if (facultySubjectMatch) return facultySubjects(Number(facultySubjectMatch[1]));
    if (state.page === "/faculty/timetable") return timetablePage("faculty");
    if (state.page === "/faculty/students") return facultyStudents();
    if (state.page === "/faculty/attendance") return facultyAttendance();
    if (state.page === "/faculty/profile") return profile("faculty");

    if (state.page === "/student/dashboard") return studentDashboard();
    if (state.page === "/student/courses") return studentCourses();
    if (state.page === "/student/timetable") return timetablePage("student");
    if (state.page === "/student/profile") return profile("student");
    if (state.page === "/student/attendance") return placeholder("Attendance", "Attendance view placeholder kept in vanilla JS for future expansion.");

    placeholder("Not Found", "The requested page does not exist.");
  } catch (error) {
    shell("Something went wrong", "The request could not be completed.", `<div class="notice error">${escapeHtml(error.message)}</div>`);
  }
}

document.addEventListener("click", async (event) => {
  try {
    const rawTarget = event.target;
    const target = rawTarget instanceof Element
      ? rawTarget
      : (rawTarget && rawTarget.parentElement ? rawTarget.parentElement : null);
    if (!target) return;

    const route = target.closest("[data-route]");
    if (route) {
      event.preventDefault();
      go(route.dataset.route);
      return;
    }

    const deleteButton = target.closest("[data-delete]");
    if (deleteButton) {
      event.preventDefault();
      if (!confirm("Delete this record?")) return;
      await api(deleteButton.dataset.delete, { method: "DELETE" });
      render();
      return;
    }

    const createButton = target.closest("[data-create-key]");
    if (createButton) {
      event.preventDefault();
      state.edit[createButton.dataset.createKey] = { __create: true };
      render();
      return;
    }

    const editButton = target.closest("[data-edit-key]");
    if (editButton) {
      event.preventDefault();
      state.edit[editButton.dataset.editKey] = JSON.parse(decodeURIComponent(editButton.dataset.editRow));
      render();
      return;
    }

    const clear = target.closest("[data-clear-edit]");
    if (clear) {
      event.preventDefault();
      const key = clear.dataset.clearEdit;
      state.edit[key] = null;
      if (key === "students") state.edit.adminStudentView = "view";
      if (key === "faculty") state.edit.adminFacultyView = "view";
      render();
      return;
    }

    const editCourse = target.closest("[data-edit-course]");
    if (editCourse) {
      event.preventDefault();
      const course = await api(`/api/courses/${editCourse.dataset.editCourse}`);
      state.edit.course = course;
      render();
      return;
    }

    const register = target.closest("[data-register]");
    if (register) {
      event.preventDefault();
      await api("/api/student/registrations", {
        method: "POST",
        body: JSON.stringify({ courseId: Number(register.dataset.register) })
      });
      render();
      return;
    }

    const drop = target.closest("[data-drop]");
    if (drop) {
      event.preventDefault();
      await api(`/api/student/registrations/${drop.dataset.drop}`, { method: "DELETE" });
      render();
      return;
    }

    const markFacultyAttendance = target.closest("[data-mark-faculty-attendance]");
    if (markFacultyAttendance) {
      event.preventDefault();
    const slotContainer = markFacultyAttendance.closest(".slot");
    if (slotContainer) {
      for (const button of slotContainer.querySelectorAll("[data-mark-faculty-attendance]")) {
        button.disabled = true;
      }
    }
    try {
      const response = await api("/api/faculty/timetable/attendance", {
        method: "POST",
        body: JSON.stringify({
          timetableId: Number(markFacultyAttendance.dataset.markFacultyAttendance),
          status: markFacultyAttendance.dataset.markStatus,
          date: markFacultyAttendance.dataset.markDate
        })
      });
      setFlash(response.message || "Slot updated.", response.status === "Absent" ? "error" : "success", "faculty-timetable");
    } catch (error) {
      if (slotContainer) {
        for (const button of slotContainer.querySelectorAll("[data-mark-faculty-attendance]")) {
          button.disabled = false;
        }
      }
      setFlash(error.message || "Could not update slot.", "error", "faculty-timetable");
    }
      render();
      return;
    }

    const resolveAlert = target.closest("[data-resolve-alert]");
    if (resolveAlert) {
      event.preventDefault();
    const alertId = Number(resolveAlert.dataset.resolveAlert);
    const action = resolveAlert.dataset.alertAction;
    const payload = { action };
    if (action === "replacement") {
      const select = document.querySelector(`#replace-select-${alertId}`);
      payload.replacementFacultyId = Number(select ? select.value : 0);
      if (!payload.replacementFacultyId) {
        alert("Select replacement faculty first.");
        return;
      }
      if (!confirm("Assign selected replacement faculty for this absent slot?")) return;
    }
    if (action === "free") {
      if (!confirm("Mark this slot as free class?")) return;
    }
    try {
      await api(`/api/admin/faculty-absent-alerts/${alertId}/action`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setFlash(action === "free" ? "Marked absent slot as free class." : "Replacement faculty assigned.", "success", "admin-alerts");
    } catch (error) {
      setFlash(error.message || "Could not resolve alert.", "error", "admin-alerts");
    }
      render();
      return;
    }

    const publish = target.closest("[data-publish]");
    if (publish && state.timetableResult) {
      event.preventDefault();
    const option = state.timetableResult.options[publish.dataset.publish];
    const missingFaculty = (state.timetableResult.missingFaculty || []).length;
    const unscheduled = (option.unscheduled || []).length;
    const conflictCount = Number((option.metrics && option.metrics.conflictCount) || 0);
    if (!option.schedule || !option.schedule.length) {
      setFlash("Cannot publish an empty timetable option.", "error", "timetable");
      render();
      return;
    }
    if (missingFaculty || unscheduled || conflictCount) {
      const proceed = confirm(`This option has issues (Missing Faculty: ${missingFaculty}, Unscheduled: ${unscheduled}, Conflicts: ${conflictCount}). Publish anyway?`);
      if (!proceed) return;
    }
    try {
      await api("/api/timetable/publish", {
        method: "POST",
        body: JSON.stringify({
          department_id: String(state.edit.adminTtDept || ""),
          semester: String(state.edit.adminTtSemester || state.timetableResult.semester || ""),
          groupId: Number(state.timetableResult.groupId || 0),
          groupName: state.timetableResult.groupName,
          schedule: option.schedule,
          autoResolvePublishedConflicts: true
        })
      });
      state.timetablePublishedOption = publish.dataset.publish || state.timetableOption || "A";
      setFlash("Timetable published successfully.", "success", "timetable");
    } catch (error) {
      const message = String((error && error.message) || "");
      if (message.includes("Conflict found for")) {
        try {
          await api("/api/timetable/publish", {
            method: "POST",
            body: JSON.stringify({
              department_id: String(state.edit.adminTtDept || ""),
              semester: String(state.edit.adminTtSemester || state.timetableResult.semester || ""),
              groupId: Number(state.timetableResult.groupId || 0),
              groupName: state.timetableResult.groupName,
              schedule: option.schedule,
              autoResolvePublishedConflicts: true,
              forceReplaceConflicts: true
            })
          });
          state.timetablePublishedOption = publish.dataset.publish || state.timetableOption || "A";
          setFlash("Timetable published successfully (auto-resolved conflicts).", "success", "timetable");
          render();
          return;
        } catch (_retryError) {
          // fall through to diagnostics below
        }
      }
      let diagnosticNote = "";
      try {
        const diagnostics = await api("/api/timetable/conflict-diagnostics", {
          method: "POST",
          body: JSON.stringify({
            groupId: Number(state.timetableResult.groupId || 0),
            groupName: state.timetableResult.groupName,
            schedule: option.schedule || []
          })
        });
        diagnosticNote = formatConflictDiagnosticsMessage(diagnostics);
      } catch (_diagError) {
        diagnosticNote = "";
      }
      const base = error.message || "Could not publish timetable.";
      setFlash(diagnosticNote ? `${base} ${diagnosticNote}` : base, "error", "timetable");
    }
      render();
      return;
    }

    const optionButton = target.closest("[data-option]");
    if (optionButton && state.timetableResult) {
      event.preventDefault();
      state.timetableOption = optionButton.dataset.option;
      render();
      return;
    }

    const generateAiDsDummyButton = target.closest("[data-generate-ai-ds-dummy]");
    if (generateAiDsDummyButton) {
      event.preventDefault();
    if (!confirm("This will remove existing academic/timetable data and create only AI and DS dummy data. Continue?")) return;
    generateAiDsDummyButton.disabled = true;
    try {
      const result = await api("/api/admin/generate-ai-ds-dummy-data", { method: "POST", body: "{}" });
      const summary = result && result.summary ? result.summary : {};
      setFlash(
        `AI and DS dummy data generated. Groups: ${summary.groups || 0}, Faculty: ${summary.facultyRecords || 0}, Students: ${summary.students || 0}, Courses: ${summary.courses || 0}, Teaching Plan: ${summary.teachingPlanRows || 0}.`,
        "success",
        "admin-dashboard"
      );
    } catch (error) {
      setFlash(error.message || "Could not generate AI and DS dummy data.", "error", "admin-dashboard");
    }
      render();
    }
  } catch (error) {
    setFlash((error && error.message) || "Action failed. Please try again.", "error");
    render();
  }
});

window.addEventListener("popstate", render);

(async function init() {
  try {
    state.user = await api("/api/auth/me");
  } catch (_error) {
    state.user = null;
  }
  render();
})();
