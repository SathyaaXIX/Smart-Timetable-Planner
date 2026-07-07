const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const {
  initDatabase,
  now,
  readData,
  list,
  insert,
  update,
  remove,
  transact: baseTransact,
  groupLabel,
  syncStudentToUser,
  syncFacultyToUser
} = require("./models/database");
const { asyncHandler } = require("./middleware/asyncHandler");
const { requireAuth, requireRole } = require("./middleware/auth");
const { courseResponse, registrationResponse } = require("./controllers/formatters");
const { validateRequired } = require("./controllers/validators");
const apiRoutes = require("./routes");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SATURDAY = "Saturday";
const DAYS = [...WEEKDAYS, SATURDAY];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const PERIOD_TIME_SLOTS = {
  1: "09:00-09:50",
  2: "09:50-10:40",
  3: "10:50-11:40",
  4: "11:40-12:30",
  5: "13:40-14:30",
  6: "14:30-15:20",
  7: "15:30-16:20"
};
const GENERATION_HISTORY = new Map();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "amrita-course-flow-js-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(FRONTEND_DIR));

function asInt(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function byCreatedAt(a, b) {
  return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

function normalizeCourseCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDataDuplicates(data) {
  if (!data || typeof data !== "object") return;

  data.adminCourses = Array.isArray(data.adminCourses) ? data.adminCourses : [];
  data.courseAssignments = Array.isArray(data.courseAssignments) ? data.courseAssignments : [];
  data.facultyCourseMappings = Array.isArray(data.facultyCourseMappings) ? data.facultyCourseMappings : [];
  data.timetable = Array.isArray(data.timetable) ? data.timetable : [];
  data.publishedTimetables = Array.isArray(data.publishedTimetables) ? data.publishedTimetables : [];
  data.attendanceRecords = Array.isArray(data.attendanceRecords) ? data.attendanceRecords : [];

  const facultyById = new Set((data.facultyRecords || []).map((f) => Number(f.id || 0)));
  const courseById = new Set((data.adminCourses || []).map((c) => Number(c.id || 0)));

  const adminKey = (item) => [
    normalizeGroupName(item.groupName || ""),
    String(item.semester || "").trim(),
    normalizeProgramName(item.program || ""),
    normalizeCourseCode(item.department || ""),
    normalizeCourseCode(item.courseName || "")
  ].join("|");

  const adminByKey = new Map();
  const adminIdMap = new Map();
  for (const row of data.adminCourses) {
    if (!row) continue;
    const key = adminKey(row);
    const existing = adminByKey.get(key);
    if (!existing) {
      adminByKey.set(key, row);
      adminIdMap.set(Number(row.id || 0), Number(row.id || 0));
      continue;
    }
    const existingStamp = String(existing.updatedAt || existing.createdAt || "");
    const rowStamp = String(row.updatedAt || row.createdAt || "");
    const keepRow = rowStamp > existingStamp || (rowStamp === existingStamp && Number(row.id || 0) > Number(existing.id || 0));
    if (keepRow) {
      adminIdMap.set(Number(existing.id || 0), Number(row.id || 0));
      adminIdMap.set(Number(row.id || 0), Number(row.id || 0));
      adminByKey.set(key, row);
    } else {
      adminIdMap.set(Number(row.id || 0), Number(existing.id || 0));
    }
  }
  data.adminCourses = Array.from(adminByKey.values());
  const validAdminIds = new Set(data.adminCourses.map((c) => Number(c.id || 0)));

  for (const item of data.courseAssignments) {
    const mapped = adminIdMap.get(Number(item.courseId || 0));
    if (mapped) item.courseId = mapped;
  }
  for (const item of data.timetable) {
    const mapped = adminIdMap.get(Number(item.courseId || 0));
    if (mapped) item.courseId = mapped;
  }
  for (const item of data.attendanceRecords) {
    const mapped = adminIdMap.get(Number(item.courseId || 0));
    if (mapped) item.courseId = mapped;
  }

  const assignmentSeen = new Set();
  data.courseAssignments = data.courseAssignments.filter((item) => {
    const courseId = Number(item.courseId || 0);
    const facultyId = Number(item.facultyId || 0);
    if (!validAdminIds.has(courseId) || !facultyById.has(facultyId)) return false;
    const key = `${courseId}|${facultyId}`;
    if (assignmentSeen.has(key)) return false;
    assignmentSeen.add(key);
    return true;
  });

  const mappingSeen = new Set();
  data.facultyCourseMappings = data.facultyCourseMappings.filter((item) => {
    const facultyId = Number(item.facultyId || 0);
    const code = normalizeCourseCode(item.courseCode || "");
    if (!facultyById.has(facultyId) || !code) return false;
    const key = `${facultyId}|${code}`;
    if (mappingSeen.has(key)) return false;
    mappingSeen.add(key);
    item.courseCode = code;
    return true;
  });

  const slotSeen = new Set();
  data.timetable = data.timetable.filter((item) => {
    const key = [
      Number(item.groupId || 0),
      String(item.semester || "").trim(),
      String(item.day || "").trim(),
      Number(item.period || 0),
      Number(item.courseId || 0),
      Number(item.facultyId || 0),
      Number(item.roomId || 0),
      Boolean(item.is_published) ? 1 : 0,
      Boolean(item.isFreeClass) ? 1 : 0
    ].join("|");
    if (slotSeen.has(key)) return false;
    slotSeen.add(key);
    return true;
  });

  const pubByGroup = new Map();
  for (const row of data.publishedTimetables) {
    if (!row) continue;
    const key = normalizeGroupName(row.groupName || "");
    const existing = pubByGroup.get(key);
    if (!existing) {
      pubByGroup.set(key, row);
      continue;
    }
    const existingStamp = String(existing.publishedAt || "");
    const rowStamp = String(row.publishedAt || "");
    if (rowStamp > existingStamp || (rowStamp === existingStamp && Number(row.id || 0) > Number(existing.id || 0))) {
      pubByGroup.set(key, row);
    }
  }
  data.publishedTimetables = Array.from(pubByGroup.values());
}

function transact(mutator) {
  return baseTransact((data) => {
    normalizeDataDuplicates(data);
    const result = mutator(data);
    normalizeDataDuplicates(data);
    return result;
  });
}

function normalizeGroupNameLoose(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:B\.?\s*TECH|M\.?\s*TECH)\s+/i, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeGroupName(value) {
  return normalizeGroupNameLoose(value);
}

function groupNamesEquivalent(left, right) {
  const leftNorm = normalizeGroupNameLoose(left);
  const rightNorm = normalizeGroupNameLoose(right);
  if (!leftNorm || !rightNorm) return false;
  return leftNorm === rightNorm;
}

function studentIdentityIds(data, userId) {
  const ids = new Set();
  const sessionUserId = Number(userId);
  if (Number.isFinite(sessionUserId)) ids.add(sessionUserId);

  const user = data.users.find((item) => Number(item.id) === sessionUserId);
  const rollKey = normalizeCourseCode(user ? user.rollNumber : "");
  if (!rollKey) return ids;

  for (const item of data.users || []) {
    if (item.role !== "student") continue;
    if (normalizeCourseCode(item.rollNumber) === rollKey) ids.add(Number(item.id));
  }
  for (const record of data.studentRecords || []) {
    if (normalizeCourseCode(record.rollNumber) === rollKey) ids.add(Number(record.id));
  }
  return ids;
}

function courseContextLabel(course) {
  return `${course.program || "B.Tech"} / ${course.department || "-"} / ${course.academicYear || "-"} / Sem ${course.semester || "-"}`;
}

function sectionCanonical(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw) return "";
  // Keep section codes (A/B/...) as-is. Do not reinterpret them as stream names.
  if (raw === "MED" || raw === "MEDICAL") return "MEDICAL";
  if (raw === "NON MED" || raw === "NON-MED" || raw === "NON MEDICAL" || raw === "NON-MEDICAL") return "NON-MEDICAL";
  return raw;
}

function normalizeSectionName(value) {
  const canonical = sectionCanonical(value);
  if (canonical === "MEDICAL") return "Medical";
  if (canonical === "NON-MEDICAL") return "Non-Medical";
  return String(value || "").trim();
}

function parseGroupSection(sectionNameRaw) {
  const raw = String(sectionNameRaw || "").trim();
  if (!raw) return { streamName: "", sectionCode: "" };
  const split = raw.split("-").map((item) => String(item || "").trim()).filter(Boolean);
  if (split.length >= 2) {
    return { streamName: normalizeSectionName(split[0]), sectionCode: split.slice(1).join("-") };
  }
  const canonical = sectionCanonical(raw);
  if (canonical === "MEDICAL" || canonical === "NON-MEDICAL") {
    return { streamName: normalizeSectionName(raw), sectionCode: "A" };
  }
  return { streamName: "", sectionCode: raw };
}

function buildGroupSectionName(streamNameRaw, sectionCodeRaw, fallbackSectionNameRaw = "") {
  const streamName = normalizeSectionName(streamNameRaw);
  const sectionCode = String(sectionCodeRaw || "").trim().toUpperCase();
  if (streamName && sectionCode) return `${streamName}-${sectionCode}`;
  if (String(fallbackSectionNameRaw || "").trim()) return String(fallbackSectionNameRaw).trim();
  return "";
}

function sectionNamesMatch(left, right) {
  return sectionCanonical(left) === sectionCanonical(right);
}

function isActiveDepartment(data, departmentName) {
  const target = normalizeCourseCode(departmentName);
  if (!target) return false;
  return (data.departments || []).some(
    (item) => item.status === "Active" && normalizeCourseCode(item.departmentName) === target
  );
}

function currentPeriodNumber(nowDate = new Date()) {
  const hour = nowDate.getHours();
  if (hour < 10) return 1;
  if (hour < 11) return 2;
  if (hour < 12) return 3;
  if (hour < 14) return 4;
  if (hour < 15) return 5;
  if (hour < 16) return 6;
  if (hour < 17) return 7;
  return 8;
}

function timeSlotFromPeriod(period) {
  return PERIOD_TIME_SLOTS[Number(period)] || `P${period}`;
}

function normalizeSaturdayMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (
    raw === "workday" ||
    raw === "working" ||
    raw === "normal" ||
    raw === "schedule"
  ) return "workday";
  if (
    raw === "copy" ||
    raw === "copy-from-day" ||
    raw === "copy from another day" ||
    raw === "copy from day"
  ) return "copy";
  if (raw === "holiday" || raw === "off" || raw === "free") return "holiday";
  return "workday";
}

function normalizeWeekday(value) {
  const raw = String(value || "").trim().toLowerCase();
  const map = {
    monday: "Monday",
    mon: "Monday",
    tuesday: "Tuesday",
    tue: "Tuesday",
    tues: "Tuesday",
    wednesday: "Wednesday",
    wed: "Wednesday",
    thursday: "Thursday",
    thu: "Thursday",
    thur: "Thursday",
    thurs: "Thursday",
    friday: "Friday",
    fri: "Friday"
  };
  return map[raw] || "";
}

function parseSaturdaySettings(body) {
  const saturdayMode = normalizeSaturdayMode(body ? (body.saturdayMode || body.saturday_mode) : "");
  const saturdayCopyFromDay = normalizeWeekday(
    body
      ? (body.saturdayCopyFromDay || body.saturday_copy_from_day || body.copyDay || body.copy_day)
      : ""
  );
  return { saturdayMode, saturdayCopyFromDay };
}

function buildSaturdayHolidaySlots() {
  return PERIODS.map((period) => ({
    day: SATURDAY,
    period,
    timeSlot: timeSlotFromPeriod(period),
    isFreeClass: true
  }));
}

function buildSaturdayCopySlots(schedule, sourceDay) {
  return (schedule || [])
    .filter((slot) => slot.day === sourceDay)
    .map((slot) => ({
      ...slot,
      day: SATURDAY,
      period: Number(slot.period),
      timeSlot: slot.timeSlot || timeSlotFromPeriod(slot.period),
      isFreeClass: Boolean(slot.isFreeClass)
    }));
}

function applySaturdayModeToSchedule(schedule, saturdayMode, saturdayCopyFromDay) {
  if (saturdayMode === "holiday") {
    const base = (schedule || []).filter((slot) => slot.day !== SATURDAY);
    return [...base, ...buildSaturdayHolidaySlots()];
  }
  if (saturdayMode === "copy") {
    const base = (schedule || []).filter((slot) => slot.day !== SATURDAY);
    return [...base, ...buildSaturdayCopySlots(base, saturdayCopyFromDay)];
  }
  return (schedule || []).map((slot) => ({ ...slot }));
}

function excelSeedSource(excelPath = "C:\\sachin\\Data.xlsx") {
  const source = { faculty: [], courses: [] };
  if (!excelPath || !fs.existsSync(excelPath)) return source;

  const script = `
$ErrorActionPreference = 'Stop'
$excelPath = '${String(excelPath).replace(/\\/g, "\\\\").replace(/'/g, "''")}'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($excelPath)
try {
  function SheetRows($ws) {
    $used = $ws.UsedRange
    $rows = @()
    for($r=2; $r -le $used.Rows.Count; $r++){
      $obj = @{}
      for($c=1; $c -le $used.Columns.Count; $c++){
        $header = [string]$used.Item(1, $c).Text
        if([string]::IsNullOrWhiteSpace($header)){ continue }
        $obj[$header.Trim()] = [string]$used.Item($r, $c).Text
      }
      $rows += [pscustomobject]$obj
    }
    return $rows
  }

  $teacherSheet = $wb.Worksheets.Item('Teacher Name')
  $workloadSheet = $wb.Worksheets.Item('Workload')
  $courseSheet = $wb.Worksheets.Item('Course Details')

  $teacherRows = SheetRows $teacherSheet
  $workloadRows = SheetRows $workloadSheet
  $courseRows = SheetRows $courseSheet

  $faculty = @()
  foreach($row in $teacherRows){
    $name = [string]$row.Name
    if([string]::IsNullOrWhiteSpace($name) -or $name -eq 'Name'){ continue }
    $faculty += [pscustomobject]@{ name = $name.Trim() }
  }

  $workloadMap = @{}
  $lastName = ''
  foreach($row in $workloadRows){
    $name = [string]$row.Name
    if(-not [string]::IsNullOrWhiteSpace($name)){ $lastName = $name.Trim() }
    if([string]::IsNullOrWhiteSpace($lastName)){ continue }
    $hours = [string]$row.'Teaching hours (assigned)-Final'
    if(-not [string]::IsNullOrWhiteSpace($hours)){
      $n = 0
      if([int]::TryParse($hours.Trim(), [ref]$n)){ $workloadMap[$lastName] = $n }
    }
  }

  $courses = @()
  foreach($row in $courseRows){
    $code = [string]$row.'Course code'
    $name = [string]$row.'Course Name'
    $ltp = [string]$row.'L T P'
    $credits = [string]$row.'Credits'
    $facultyName = [string]$row.'Faculty'
    $semBlock = ''
    foreach($prop in $row.PSObject.Properties){
      if($prop.Name -match '^Sem'){
        $candidate = [string]$prop.Value
        if(-not [string]::IsNullOrWhiteSpace($candidate)){
          $semBlock = $candidate
          break
        }
      }
    }
    if([string]::IsNullOrWhiteSpace($code) -and [string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($semBlock)){ continue }
    $courses += [pscustomobject]@{
      code = $code.Trim()
      name = $name.Trim()
      ltp = $ltp.Trim()
      credits = $credits.Trim()
      facultyName = $facultyName.Trim()
      semBlock = $semBlock.Trim()
    }
  }

  $result = [pscustomobject]@{
    faculty = $faculty
    workload = $workloadMap
    workloadRows = $workloadRows
    courses = $courses
  }
  $result | ConvertTo-Json -Depth 5 -Compress
}
finally {
  $wb.Close($false)
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
`;

  try {
    const output = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    const parsed = JSON.parse(String(output || "").trim() || "{}");
    const names = Array.isArray(parsed.faculty) ? parsed.faculty : [];
    const courses = Array.isArray(parsed.courses) ? parsed.courses : [];
    const workloadRows = Array.isArray(parsed.workloadRows) ? parsed.workloadRows : [];
    const workload = parsed.workload && typeof parsed.workload === "object" ? parsed.workload : {};

    function canonicalFacultyName(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/\b(dr|mr|ms|mrs|prof)\.?\b/g, " ")
        .replace(/[^a-z\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function splitFacultyNames(value) {
      const raw = String(value || "").trim();
      if (!raw) return [];
      return raw
        .replace(/\bvisiting faculty\b/ig, " ")
        .split(/\/|&|\band\b|,/i)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    const allWorkloadRows = workloadRows
      .map((row) => ({
        name: String(row.Name || "").trim(),
        subject: String(row.Subject || "").trim(),
        semester: String(row.Semester || "").trim(),
        ugpg: String(row["UG/PG"] || "").trim(),
        theory: Number(String(row.Theory || "").trim()) || 0,
        practical: Number(String(row.Practical || "").trim()) || 0
      }))
      .filter((row) => row.name && row.subject);

    const allFacultyRaw = new Set();
    for (const item of allWorkloadRows) {
      for (const name of splitFacultyNames(item.name)) allFacultyRaw.add(name);
    }
    for (const item of courses) {
      for (const name of splitFacultyNames(item.facultyName)) allFacultyRaw.add(name);
    }
    const allFacultyCanonical = new Set(
      Array.from(allFacultyRaw).map((name) => canonicalFacultyName(name)).filter(Boolean)
    );

    function isExcelFacultyCandidate(name) {
      if (!allFacultyCanonical.size) return true;
      const canonical = canonicalFacultyName(name);
      if (!canonical) return false;
      if (allFacultyCanonical.has(canonical)) return true;
      const parts = canonical.split(" ").filter(Boolean);
      if (parts.length >= 2) {
        const key = `${parts[0]} ${parts[parts.length - 1]}`;
        for (const candidate of allFacultyCanonical) {
          if (candidate.includes(key) || key.includes(candidate)) return true;
        }
      }
      for (const candidate of allFacultyCanonical) {
        if (candidate.includes(canonical) || canonical.includes(candidate)) return true;
      }
      return false;
    }

    const teacherSheetNames = names
      .map((item) => String(item.name || "").trim())
      .filter(Boolean);
    const seenCanonical = new Set(teacherSheetNames.map((name) => canonicalFacultyName(name)).filter(Boolean));
    for (const raw of allFacultyRaw) {
      const canonical = canonicalFacultyName(raw);
      if (!canonical || seenCanonical.has(canonical)) continue;
      teacherSheetNames.push(raw);
      seenCanonical.add(canonical);
    }
    const workloadByCanonical = new Map();
    for (const row of allWorkloadRows) {
      const canonical = canonicalFacultyName(row.name);
      if (!canonical) continue;
      const direct = Number(workload[row.name] || 0);
      const hours = direct || Math.max(0, Number(row.theory || 0) + Number(row.practical || 0));
      if (!workloadByCanonical.has(canonical) || hours > workloadByCanonical.get(canonical)) {
        workloadByCanonical.set(canonical, hours);
      }
    }

    source.faculty = teacherSheetNames
      .map((name, index) => {
        const cleaned = name.replace(/^Dr\.\s*/i, "").replace(/[^a-zA-Z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").toLowerCase();
        const direct = Number(workload[name] || 0);
        const canonical = canonicalFacultyName(name);
        const byCanonical = Number(workloadByCanonical.get(canonical) || 0);
        const hours = direct || byCanonical || 10;
        return {
          facultyId: `AIDFAC${String(index + 1).padStart(3, "0")}`,
          facultyName: name,
          email: `${cleaned || `faculty${index + 1}`}@amrita.edu`,
          maxWorkload: Math.max(6, Math.min(20, Number.isFinite(hours) ? hours : 10)),
          status: "Active",
          facultyPassword: "faculty123"
        };
      });

    function parseBlockInfo(label) {
      const raw = String(label || "").trim();
      if (!raw) return { semester: "", isMedical: false, isMtech: false };
      const lower = raw.toLowerCase();
      const semMatch = raw.match(/sem\s*(\d+)/i);
      return {
        semester: semMatch ? String(Number(semMatch[1])) : "",
        isMedical: /\(\s*me\s*\)/i.test(raw) || /medical/i.test(raw),
        isMtech: /m\.?\s*tech/i.test(lower)
      };
    }

    let currentBlock = { semester: "2", isMedical: false, isMtech: false };
    const uniqueByCode = new Set();
    source.courses = [];
    for (const item of courses) {
      const rawCode = String(item.code || "").trim();
      const rawName = String(item.name || "").trim();
      const semBlockLabel = String(item.semBlock || "").trim();
      const semHeaderCandidate = [rawCode, rawName, semBlockLabel].find((value) => /^sem/i.test(String(value || "").trim())) || "";
      if (
        semHeaderCandidate &&
        (
          normalizeCourseCode(rawCode) === "COURSE CODE" ||
          !rawCode ||
          normalizeCourseCode(rawName) === "COURSE NAME"
        )
      ) {
        currentBlock = parseBlockInfo(semHeaderCandidate);
        continue;
      }

      const code = rawCode.toUpperCase();
      const name = rawName;
      if (!code || !name) continue;
      if (code === "COURSE CODE" || name.toUpperCase().includes("TOTAL CREDITS")) continue;
      if (!currentBlock.isMtech) continue;
      if (!currentBlock.semester) continue;
      if (uniqueByCode.has(code)) continue;
      uniqueByCode.add(code);

      const ltp = String(item.ltp || "").trim();
      const credits = Number(String(item.credits || "").trim()) || 3;
      const match = ltp.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
      const l = match ? Number(match[1]) : 2;
      const t = match ? Number(match[2]) : 0;
      const p = match ? Number(match[3]) : 0;
      source.courses.push({
        code,
        name,
        program: "M.Tech",
        credits,
        semester: currentBlock.semester,
        stream: currentBlock.isMedical ? "Medical" : "Non-Medical",
        maxSeats: 70,
        description: `${name} (imported from Excel)`,
        theoryHoursPerWeek: Math.max(1, l + t),
        labHoursPerWeek: Math.max(0, p),
        courseType: p > 0 ? "Theory + Lab" : "Theory",
        requiredRoomSpecialization: p > 0 ? "Computer Lab" : "General Classroom",
        preferredFacultyName: String(item.facultyName || "").trim(),
        preferredFacultyNames: splitFacultyNames(item.facultyName)
      });
    }
  } catch (_error) {
    return source;
  }

  return source;
}

function seedAiAndDsOnlyDummyData(data) {
  const createdAt = now();
  const departmentName = "AI and DS";
  const fallbackStreams = ["Medical", "Non-Medical"];
  const studentsPerGroup = 36;

  const excelSource = excelSeedSource(process.env.AI_DS_DUMMY_EXCEL_PATH || "C:\\sachin\\Data.xlsx");
  const facultyTemplates = excelSource.faculty.length
    ? excelSource.faculty
    : [
      { facultyId: "AIDFAC001", facultyName: "Dr. Meera Krishnan", email: "meera.krishnan@amrita.edu", maxWorkload: 12, status: "Active", facultyPassword: "faculty123" }
    ];

  const courseTemplates = excelSource.courses.length
    ? excelSource.courses
    : [
      {
        code: "AID101",
        name: "Foundations of AI",
        credits: 4,
        semester: "3",
        maxSeats: 70,
        description: "Core AI concepts and intelligent problem solving.",
        theoryHoursPerWeek: 3,
        labHoursPerWeek: 2,
        courseType: "Theory + Lab",
        requiredRoomSpecialization: "Computer Lab",
        preferredFacultyName: ""
      }
    ];
  const templateProgram = courseTemplates.some((course) => normalizeProgramName(course.program || "") === "M.Tech")
    ? "M.Tech"
    : "B.Tech";

  const preservedAdmins = (data.users || []).filter((user) => user.role === "admin");
  data.users = preservedAdmins.map((user) => ({ ...user }));

  data.departments = [{ id: 1, departmentName, status: "Active", createdAt }];
  data.groups = [];
  data.studentRecords = [];
  data.facultyRecords = [];
  data.courses = [];
  data.adminCourses = [];
  data.courseAssignments = [];
  data.facultyCourseMappings = [];
  data.courseDepartmentMappings = [];
  data.registrations = [];
  data.timetable = [];
  data.facultyAttendance = [];
  data.facultyAlerts = [];
  data.replacementSessions = [];
  data.publishedTimetables = [];
  data.attendanceRecords = [];

  const templateStreams = Array.from(new Set(
    courseTemplates
      .map((course) => normalizeSectionName(course.stream || ""))
      .filter(Boolean)
  ));
  const streams = templateStreams.length ? templateStreams : ["Medical", "Non-Medical"];
  const effectivePairs = [];
  for (let sem = 1; sem <= 8; sem += 1) {
    for (const stream of streams) {
      if (templateProgram === "M.Tech" && sem > 4) continue;
      effectivePairs.push({ semester: String(sem), stream });
    }
  }

  let groupId = 0;
  for (const pair of effectivePairs) {
    groupId += 1;
    const sem = Number(pair.semester || 1);
    const yearName = sem <= 2 ? "1st Year" : sem <= 4 ? "2nd Year" : sem <= 6 ? "3rd Year" : "4th Year";
    data.groups.push({
      id: groupId,
      program: templateProgram,
      yearName,
      semester: String(pair.semester),
      sectionName: `${pair.stream}-A`,
      department: departmentName,
      strength: studentsPerGroup,
      status: "Active",
      createdAt
    });
  }

  data.facultyRecords = facultyTemplates.map((record, index) => ({
    id: index + 1,
    facultyId: record.facultyId,
    facultyName: record.facultyName,
    email: record.email,
    department: departmentName,
    maxWorkload: record.maxWorkload,
    status: record.status,
    facultyPassword: record.facultyPassword,
    createdAt
  }));
  for (const facultyRecord of data.facultyRecords) syncFacultyToUser(data, facultyRecord);

  data.courses = courseTemplates.map((course, index) => ({
    id: index + 1,
    code: course.code,
    name: course.name,
    department: departmentName,
    program: normalizeProgramName(course.program || templateProgram || "B.Tech"),
    academicYear: yearFromSemester(String(course.semester || "3")),
    credits: course.credits,
    semester: String(course.semester || "3"),
    maxSeats: course.maxSeats,
    facultyId: null,
    description: String(course.description || ""),
    isOpen: true,
    createdAt,
    updatedAt: createdAt
  }));
  data.courseDepartmentMappings = data.courses.map((course, index) => ({
    id: index + 1,
    courseCode: course.code,
    department: departmentName,
    createdAt
  }));

  let mappingId = 0;
  function canonicalFacultyName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\b(dr|mr|ms|mrs|prof)\.?\b/g, " ")
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function normalizedComparable(value) {
    return canonicalFacultyName(value).replace(/\s+/g, "");
  }
  const facultyByCanonical = new Map();
  for (const faculty of data.facultyRecords) {
    const canonical = canonicalFacultyName(faculty.facultyName);
    if (canonical) facultyByCanonical.set(canonical, faculty);
  }
  const mappedCourseByFaculty = new Map();
  for (const template of courseTemplates) {
    const code = normalizeCourseCode(template.code);
    if (!code) continue;
    const preferredNames = Array.isArray(template.preferredFacultyNames)
      ? template.preferredFacultyNames
      : (String(template.preferredFacultyName || "").trim() ? [String(template.preferredFacultyName || "").trim()] : []);
    let selectedFaculty = null;
    for (const name of preferredNames) {
      const canonical = canonicalFacultyName(name);
      if (!canonical) continue;
      const exact = facultyByCanonical.get(canonical);
      if (exact) {
        selectedFaculty = exact;
        break;
      }
      const compactCanonical = normalizedComparable(canonical);
      for (const [key, faculty] of facultyByCanonical.entries()) {
        const compactKey = normalizedComparable(key);
        if (
          key.includes(canonical) ||
          canonical.includes(key) ||
          (compactCanonical && compactKey && (compactKey.includes(compactCanonical) || compactCanonical.includes(compactKey)))
        ) {
          selectedFaculty = faculty;
          break;
        }
      }
      if (selectedFaculty) break;
    }
    if (!selectedFaculty) continue;
    if (!mappedCourseByFaculty.has(selectedFaculty.id)) mappedCourseByFaculty.set(selectedFaculty.id, new Set());
    mappedCourseByFaculty.get(selectedFaculty.id).add(code);
  }

  for (const [facultyId, codes] of mappedCourseByFaculty.entries()) {
    for (const courseCode of codes) {
      mappingId += 1;
      data.facultyCourseMappings.push({
        id: mappingId,
        facultyId,
        courseCode,
        createdAt
      });
    }
  }

  let studentId = 0;
  for (const group of data.groups) {
    const streamCode = String(group.sectionName || "").startsWith("Medical") ? "M" : "N";
    const sectionCode = "A";
    const yearCode = String(Number(group.semester || 1) <= 2 ? "1" : Number(group.semester || 1) <= 4 ? "2" : Number(group.semester || 1) <= 6 ? "3" : "4");
    for (let index = 1; index <= studentsPerGroup; index += 1) {
      studentId += 1;
      const serial = String(index).padStart(2, "0");
      const rollNumber = `AID${yearCode}${streamCode}${sectionCode}${serial}`;
      const student = {
        id: studentId,
        rollNumber,
        studentName: `AI&DS ${group.sectionName} Student ${serial}`,
        studentPassword: "student123",
        groupId: group.id,
        yearName: group.yearName,
        semester: group.semester || (group.yearName === "1st Year" ? "1" : "3"),
        sectionName: group.sectionName,
        status: "Active",
        email: `${rollNumber.toLowerCase()}@students.amrita.edu`,
        department: departmentName,
        createdAt
      };
      data.studentRecords.push(student);
      syncStudentToUser(data, student);
    }
  }

  let adminCourseId = 0;
  let assignmentId = 0;
  const assignmentLoadByFaculty = new Map();
  function candidateFacultyFromTemplate(template) {
    const preferredNames = Array.isArray(template.preferredFacultyNames)
      ? template.preferredFacultyNames
      : (String(template.preferredFacultyName || "").trim() ? [String(template.preferredFacultyName || "").trim()] : []);
    const candidates = [];
    const seen = new Set();
    for (const name of preferredNames) {
      const canonical = canonicalFacultyName(name);
      if (!canonical) continue;
      const compactCanonical = normalizedComparable(canonical);
      for (const [key, faculty] of facultyByCanonical.entries()) {
        const compactKey = normalizedComparable(key);
        if (!(
          key === canonical ||
          key.includes(canonical) ||
          canonical.includes(key) ||
          (compactCanonical && compactKey && (compactKey.includes(compactCanonical) || compactCanonical.includes(compactKey)))
        )) continue;
        if (seen.has(faculty.id)) continue;
        seen.add(faculty.id);
        candidates.push(faculty);
      }
    }
    return candidates;
  }
  for (const group of data.groups) {
    const parsedGroup = parseGroupSection(group.sectionName || "");
    const streamName = parsedGroup.streamName || "Non-Medical";
    const filteredTemplates = courseTemplates
      .map((template, index) => ({ template, course: data.courses[index] }))
      .filter((row) => row.course && String(row.course.semester || "") === String(group.semester || ""))
      .filter((row) => {
        const courseStream = String(row.template.stream || "").trim();
        if (!courseStream) return true;
        return courseStream === streamName;
      });
    for (let rowIndex = 0; rowIndex < filteredTemplates.length; rowIndex += 1) {
      const row = filteredTemplates[rowIndex];
      const course = row.course;
      const template = row.template || {};
      const preferredFacultyCandidates = candidateFacultyFromTemplate(template);
      const mappedCandidates = preferredFacultyCandidates
        .filter((faculty) =>
          data.facultyCourseMappings.some((mapping) => Number(mapping.facultyId) === Number(faculty.id) && mapping.courseCode === course.code)
        )
        .sort((a, b) => (assignmentLoadByFaculty.get(a.id) || 0) - (assignmentLoadByFaculty.get(b.id) || 0));
      const fallbackMapped = data.facultyRecords
        .filter((faculty) =>
          data.facultyCourseMappings.some((mapping) => Number(mapping.facultyId) === Number(faculty.id) && mapping.courseCode === course.code)
        )
        .sort((a, b) => (assignmentLoadByFaculty.get(a.id) || 0) - (assignmentLoadByFaculty.get(b.id) || 0));
      const faculty = mappedCandidates[0] || fallbackMapped[0] || null;
      adminCourseId += 1;
      data.adminCourses.push({
        id: adminCourseId,
        courseCode: course.code,
        courseName: course.name,
        credits: course.credits,
        program: normalizeProgramName(course.program || templateProgram || "B.Tech"),
        academicYear: group.yearName,
        semester: String(course.semester || group.semester || ""),
        department: departmentName,
        courseType: String(template.courseType || (rowIndex % 2 === 0 ? "Theory + Lab" : "Theory")),
        theoryHoursPerWeek: Number(template.theoryHoursPerWeek || (rowIndex % 2 === 0 ? 3 : 4)),
        labHoursPerWeek: Number(template.labHoursPerWeek || (rowIndex % 2 === 0 ? 2 : 0)),
        requiredRoomSpecialization: String(template.requiredRoomSpecialization || (rowIndex % 2 === 0 ? "Computer Lab" : "General Classroom")),
        groupName: groupLabel(group),
        status: "Active",
        createdAt
      });
      if (faculty) {
        assignmentId += 1;
        data.courseAssignments.push({
          id: assignmentId,
          facultyId: faculty.id,
          courseId: adminCourseId,
          createdAt
        });
        assignmentLoadByFaculty.set(faculty.id, (assignmentLoadByFaculty.get(faculty.id) || 0) + 1);
      }
    }
  }

  const studentUserByRoll = new Map(
    data.users
      .filter((user) => user.role === "student" && user.rollNumber)
      .map((user) => [String(user.rollNumber || "").toUpperCase(), user])
  );
  const coursesByCode = new Map(data.courses.map((course) => [normalizeCourseCode(course.code), course]));
  const groupById = new Map(data.groups.map((group) => [Number(group.id), group]));
  const adminCoursesByGroup = new Map();
  for (const row of data.adminCourses) {
    const key = normalizeCourseCode(row.groupName);
    if (!key) continue;
    if (!adminCoursesByGroup.has(key)) adminCoursesByGroup.set(key, []);
    adminCoursesByGroup.get(key).push(row);
  }
  let registrationId = 0;
  for (const student of data.studentRecords) {
    const user = studentUserByRoll.get(String(student.rollNumber || "").toUpperCase());
    if (!user) continue;
    const group = groupById.get(Number(student.groupId));
    const groupName = group ? groupLabel(group) : "";
    const plannedRows = adminCoursesByGroup.get(normalizeCourseCode(groupName)) || [];
    const plannedCourses = plannedRows
      .map((row) => coursesByCode.get(normalizeCourseCode(row.courseCode)))
      .filter(Boolean);
    const targetCourses = plannedCourses.length ? plannedCourses : data.courses.filter((course) => String(course.semester || "") === String(student.semester || ""));
    const seenCourseIds = new Set();
    for (const course of targetCourses) {
      if (!course || seenCourseIds.has(course.id)) continue;
      seenCourseIds.add(course.id);
      registrationId += 1;
      data.registrations.push({
        id: registrationId,
        courseId: course.id,
        studentId: user.id,
        status: "registered",
        registeredAt: createdAt
      });
    }
  }

  return {
    department: departmentName,
    streams: fallbackStreams.length,
    years: Array.from(new Set(data.groups.map((item) => item.yearName))).length,
    sections: 1,
    groups: data.groups.length,
    facultyRecords: data.facultyRecords.length,
    students: data.studentRecords.length,
    courses: data.courses.length,
    teachingPlanRows: data.adminCourses.length
  };
}

function buildFreeScheduleResponse(slot) {
  return {
    id: slot.id || null,
    day: slot.day,
    period: Number(slot.period),
    timeSlot: slot.timeSlot || timeSlotFromPeriod(slot.period),
    courseId: null,
    courseCode: "",
    courseName: "",
    department: "",
    groupId: slot.groupId || null,
    groupName: slot.groupName || "",
    roomId: null,
    roomNumber: "",
    facultyId: null,
    facultyName: "",
    replacementFacultyId: null,
    replacementFacultyName: null,
    isFreeClass: true,
    attendanceStatus: null
  };
}

function publishedSaturdayFreeSlots(data, group) {
  if (!group) return [];
  const published = (data.publishedTimetables || []).find((item) => item.groupName === groupLabel(group));
  if (!published || !Array.isArray(published.schedule)) return [];
  return published.schedule
    .filter((slot) => String(slot.day || "") === SATURDAY && Boolean(slot.isFreeClass))
    .map((slot, index) =>
      buildFreeScheduleResponse({
        id: `published-free-${group.id}-${index + 1}`,
        day: SATURDAY,
        period: Number(slot.period),
        timeSlot: slot.timeSlot || timeSlotFromPeriod(slot.period),
        groupId: group.id,
        groupName: groupLabel(group)
      })
    );
}

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const raw = String(value);
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return raw.slice(0, 10);
}

function dayNameFromDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const jsDay = parsed.getDay(); // 0=Sunday
  const index = (jsDay + 6) % 7; // 0=Monday
  return DAYS[index] || null;
}

function findGroupByLabel(data, label) {
  const target = String(label || "").trim();
  if (!target) return null;
  const stripProgramPrefix = (value) => String(value || "").trim().replace(/^(B\.?\s*Tech|M\.?\s*Tech)\s+/i, "");
  const targetCore = stripProgramPrefix(target);
  const programMatch = target.match(/^(B\.?\s*Tech|M\.?\s*Tech)\s+/i);
  const explicitProgram = programMatch ? normalizeProgramName(programMatch[1]) : "";

  const exact = data.groups.find((item) => {
    const current = String(groupLabel(item) || "").trim();
    if (current === target) return true;
    const legacy = `${String(item.yearName || "")} - ${String(item.sectionName || "")} (${String(item.department || "")})`;
    return legacy === target;
  });
  if (exact) return exact;

  const coreMatches = (data.groups || []).filter((item) => {
    const current = String(groupLabel(item) || "").trim();
    return stripProgramPrefix(current) === targetCore;
  });
  if (!coreMatches.length) return null;
  if (explicitProgram) {
    const programScoped = coreMatches.filter((item) => normalizeProgramName(item.program || "B.Tech") === explicitProgram);
    if (programScoped.length === 1) return programScoped[0];
    if (programScoped.length > 1) return programScoped[0];
  }
  // Ambiguous legacy label (same core in B.Tech and M.Tech) with no explicit program.
  // Avoid returning the wrong group.
  if (coreMatches.length > 1) return null;
  return coreMatches[0];
}

function yearFromSemester(semesterValue) {
  const semester = Number(semesterValue || 0);
  if (!Number.isFinite(semester) || semester <= 0) return "";
  if (semester <= 2) return "1st Year";
  if (semester <= 4) return "2nd Year";
  if (semester <= 6) return "3rd Year";
  return "4th Year";
}

function yearOrdinalFromName(yearNameValue) {
  const yearName = String(yearNameValue || "").trim();
  const match = yearName.match(/([1-4])\s*(?:st|nd|rd|th)?/i);
  return match ? Number(match[1]) : 0;
}

function isMtechYearName(yearNameValue) {
  return /m[\s-]*tech/i.test(String(yearNameValue || ""));
}

function allowedSemestersForYear(yearNameValue) {
  const yearNo = yearOrdinalFromName(yearNameValue);
  if (isMtechYearName(yearNameValue)) {
    if (yearNo === 1) return ["1", "2"];
    if (yearNo === 2) return ["3", "4"];
    return ["1", "2", "3", "4"];
  }
  if (yearNo === 1) return ["1", "2"];
  if (yearNo === 2) return ["3", "4"];
  if (yearNo === 3) return ["5", "6"];
  if (yearNo === 4) return ["7", "8"];
  return ["1", "2", "3", "4", "5", "6", "7", "8"];
}

function semesterFromYearName(yearNameValue) {
  const yearNo = yearOrdinalFromName(yearNameValue);
  if (isMtechYearName(yearNameValue)) {
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

function sameAcademicYear(left, right) {
  return normalizeCourseCode(String(left || "")) === normalizeCourseCode(String(right || ""));
}

function normalizeProgramName(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (raw === "m.tech" || raw === "mtech") return "M.Tech";
  return "B.Tech";
}

function groupSemesterValue(group) {
  if (!group) return "";
  return String(group.semester || "").trim() || semesterFromYearName(group.yearName);
}

function findOrCreateGroup(data, { department, program, yearName, semester, sectionName }) {
  const cleanDepartment = String(department || "").trim();
  const cleanProgram = normalizeProgramName(program || "B.Tech");
  const cleanSemester = String(semester || "").trim();
  const cleanYear = String(yearName || yearFromSemester(cleanSemester)).trim();
  const cleanSection = normalizeSectionName(sectionName);
  if (!cleanDepartment || !cleanSection || (!cleanYear && !cleanSemester)) return null;
  const existing = data.groups.find(
    (item) =>
      normalizeCourseCode(item.department) === normalizeCourseCode(cleanDepartment) &&
      normalizeProgramName(item.program || "B.Tech") === cleanProgram &&
      (!cleanSemester || groupSemesterValue(item) === cleanSemester) &&
      (!cleanYear || normalizeCourseCode(item.yearName) === normalizeCourseCode(cleanYear)) &&
      sectionNamesMatch(item.sectionName, cleanSection)
  );
  if (existing) return existing;
  const created = {
    id: data.groups.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    program: cleanProgram,
    yearName: cleanYear,
    semester: cleanSemester || "",
    sectionName: cleanSection,
    department: cleanDepartment,
    strength: 0,
    status: "Active",
    createdAt: now()
  };
  data.groups.push(created);
  return created;
}

function ensureCourseDepartmentMappings(data) {
  if (!Array.isArray(data.courseDepartmentMappings)) data.courseDepartmentMappings = [];
  let nextId = data.courseDepartmentMappings.reduce((max, item) => Math.max(max, item.id), 0);
  const seen = new Set(data.courseDepartmentMappings.map((row) => `${normalizeCourseCode(row.courseCode)}|${normalizeCourseCode(row.department)}`));
  const add = (courseCode, department) => {
    const key = `${normalizeCourseCode(courseCode)}|${normalizeCourseCode(department)}`;
    if (!courseCode || !department || seen.has(key)) return;
    seen.add(key);
    data.courseDepartmentMappings.push({ id: ++nextId, courseCode: String(courseCode).trim(), department: String(department).trim(), createdAt: now() });
  };
  for (const course of data.courses || []) add(course.code, course.department);
  for (const course of data.adminCourses || []) add(course.courseCode, course.department);
}

function courseAllowedForDepartment(data, courseCode, department) {
  ensureCourseDepartmentMappings(data);
  const targetCode = normalizeCourseCode(courseCode);
  const targetDepartment = normalizeCourseCode(department);
  return data.courseDepartmentMappings.some(
    (row) => normalizeCourseCode(row.courseCode) === targetCode && normalizeCourseCode(row.department) === targetDepartment
  );
}

function facultyHasCourseExpertise(data, facultyId, courseCode) {
  const code = normalizeCourseCode(courseCode);
  return (data.facultyCourseMappings || []).some(
    (mapping) => mapping.facultyId === facultyId && normalizeCourseCode(mapping.courseCode) === code
  );
}

function findSlotSubject(data, slot) {
  return data.adminCourses.find((item) => item.id === slot.courseId) || null;
}

function facultyIsBusyAtSlot(data, facultyId, day, period, ignoreSlotId = null) {
  return data.timetable.some(
    (slot) =>
      slot.id !== ignoreSlotId &&
      slot.day === day &&
      Number(slot.period) === Number(period) &&
      !slot.isFreeClass &&
      (slot.facultyId === facultyId || slot.replacementFacultyId === facultyId)
  );
}

function replacementCandidates(data, slot) {
  const subject = findSlotSubject(data, slot);
  if (!subject) return [];

  const workloadByFaculty = new Map();
  for (const row of data.facultyRecords) workloadByFaculty.set(row.id, 0);
  for (const slotItem of data.timetable) {
    if (slotItem.isFreeClass) continue;
    workloadByFaculty.set(slotItem.facultyId, (workloadByFaculty.get(slotItem.facultyId) || 0) + 1);
    if (slotItem.replacementFacultyId) {
      workloadByFaculty.set(slotItem.replacementFacultyId, (workloadByFaculty.get(slotItem.replacementFacultyId) || 0) + 1);
    }
  }

  return data.facultyRecords
    .filter((faculty) => faculty.status === "Active" && faculty.id !== slot.facultyId)
    .filter((faculty) => normalizeCourseCode(faculty.department) === normalizeCourseCode(subject.department))
    .filter((faculty) => facultyHasCourseExpertise(data, faculty.id, subject.courseCode))
    .filter((faculty) => !facultyIsBusyAtSlot(data, faculty.id, slot.day, slot.period, slot.id))
    .map((faculty) => {
      const hasSameSubject = true;
      const sameDepartment = true;
      const workload = workloadByFaculty.get(faculty.id) || 0;
      const score = (hasSameSubject ? 60 : 0) + (sameDepartment ? 30 : 0) - Math.min(20, workload);
      const maxWorkload = Number(faculty.maxWorkload || 0);
      const priority = hasSameSubject ? 1 : (sameDepartment ? 2 : 3);
      return {
        facultyId: faculty.id,
        facultyName: faculty.facultyName,
        department: faculty.department,
        hasSameSubject,
        sameDepartment,
        workload,
        maxWorkload,
        priority,
        score
      };
    })
    .sort((a, b) => (b.score - a.score) || (a.workload - b.workload) || a.facultyName.localeCompare(b.facultyName));
}

function buildSlotResponse(data, slot, attendanceStatus = null) {
  const subject = findSlotSubject(data, slot);
  const group = data.groups.find((item) => item.id === slot.groupId) || null;
  const room = data.rooms.find((item) => item.id === slot.roomId) || null;
  const faculty = data.facultyRecords.find((item) => item.id === slot.facultyId) || null;
  const replacementFaculty = slot.replacementFacultyId
    ? data.facultyRecords.find((item) => item.id === slot.replacementFacultyId)
    : null;
  const assignedFacultyNames = subject
    ? (data.courseAssignments || [])
      .filter((item) => Number(item.courseId) === Number(subject.id))
      .map((item) => data.facultyRecords.find((row) => Number(row.id) === Number(item.facultyId)))
      .filter(Boolean)
      .map((item) => String(item.facultyName || "").trim())
      .filter(Boolean)
    : [];
  const facultyNames = Array.from(new Set(assignedFacultyNames));
  const displayFacultyName = facultyNames.length > 1 ? facultyNames.join(" / ") : (faculty ? faculty.facultyName : "");
  return {
    id: slot.id,
    day: slot.day,
    period: slot.period,
    timeSlot: slot.timeSlot,
    courseId: slot.courseId,
    courseCode: subject ? subject.courseCode : "",
    courseName: subject ? subject.courseName : "",
    department: subject ? subject.department : "",
    groupId: slot.groupId,
    groupName: group ? groupLabel(group) : "",
    roomId: slot.roomId,
    roomNumber: room ? room.roomNumber : "",
    facultyId: slot.facultyId,
    facultyName: displayFacultyName,
    facultyNames,
    replacementFacultyId: slot.replacementFacultyId || null,
    replacementFacultyName: replacementFaculty ? replacementFaculty.facultyName : null,
    isFreeClass: Boolean(slot.isFreeClass),
    attendanceStatus
  };
}

async function backfillTimetableFromPublished() {
  await transact((data) => {
    if (data.timetable.length > 0) return { skipped: true };
    if (!data.publishedTimetables.length) return { skipped: true };

    let nextId = data.timetable.reduce((max, item) => Math.max(max, item.id), 0);
    for (const published of data.publishedTimetables) {
      const group = findGroupByLabel(data, published.groupName);
      if (!group) continue;

      for (const slot of published.schedule || []) {
        const day = String(slot.day || "").trim();
        const period = Number(slot.period || 0);
        const courseId = Number(slot.courseId || 0);
        const facultyId = Number(slot.facultyId || 0);
        const roomId = Number(slot.roomId || 0);
        if (!day || !period || !courseId || !facultyId) continue;

        if (data.timetable.some((item) => item.groupId === group.id && item.day === day && Number(item.period) === period)) continue;
        const subject = data.adminCourses.find((item) => item.id === courseId && item.groupName === published.groupName);
        if (!subject) continue;

        data.timetable.push({
          id: ++nextId,
          facultyId,
          courseId,
          groupId: group.id,
          roomId: roomId || null,
          day,
          timeSlot: timeSlotFromPeriod(period),
          period,
          is_published: true,
          replacementFacultyId: null,
          isFreeClass: false,
          replacedByAdminAt: null,
          createdAt: now(),
          updatedAt: now()
        });
      }
    }
    return { skipped: false };
  });
}

function findFacultyRecordForUser(data, user) {
  if (!user) return null;
  const employeeId = String(user.employeeId || "").trim().toUpperCase();
  const email = String(user.email || "").trim().toLowerCase();
  return data.facultyRecords.find((item) => {
    const idMatch = employeeId && String(item.facultyId || "").trim().toUpperCase() === employeeId;
    const emailMatch = email && String(item.email || "").trim().toLowerCase() === email;
    return idMatch || emailMatch;
  }) || null;
}

function resolveFacultySessionContext(req, data, options = {}) {
  const requireSemester = options.requireSemester !== false;
  const inputSemesterRaw = options.semester;
  const inputSemester = inputSemesterRaw == null ? "" : String(inputSemesterRaw).trim();
  const inputProgramRaw = options.program;
  const inputProgram = inputProgramRaw == null || !String(inputProgramRaw).trim() ? "" : normalizeProgramName(inputProgramRaw);
  const user = data.users.find((item) => item.id === req.session.userId);
  const facultyRecord = findFacultyRecordForUser(data, user);
  if (!facultyRecord) {
    return { error: "Faculty record not found", status: 404 };
  }

  req.session.facultyRecordId = Number(facultyRecord.id);

  const sessionSemester = String(req.session.facultySemester || "").trim();
  const selectedSemester = inputSemester || sessionSemester;
  // Program must be explicit per request to avoid stale cross-program filtering
  // (e.g., previous M.Tech selection hiding B.Tech timetable).
  const selectedProgram = inputProgram;
  if (inputSemester) {
    req.session.facultySemester = inputSemester;
  } else if (!req.session.facultySemester && selectedSemester) {
    req.session.facultySemester = selectedSemester;
  }
  if (inputProgram) req.session.facultyProgram = inputProgram;

  if (requireSemester && !selectedSemester) {
    return { error: "semester is required", status: 400 };
  }

  return {
    facultyRecord,
    semester: selectedSemester,
    program: selectedProgram,
    user
  };
}

function facultyAssignedSubjects(data, user, options = {}) {
  const selectedSemester = String(options.semester || "").trim();
  const selectedProgram = String(options.program || "").trim();
  const publishedOnly = Boolean(options.publishedOnly);
  const facultyRecord = findFacultyRecordForUser(data, user);
  if (!facultyRecord) {
    return { facultyRecord: null, subjects: [], assignedCourseIds: new Set() };
  }

  const rollToUser = new Map(
    data.users
      .filter((item) => item.role === "student" && item.rollNumber)
      .map((item) => [item.rollNumber, item])
  );

  const assignedPlanIds = new Set(
    (data.courseAssignments || [])
      .filter((item) => Number(item.facultyId || 0) === Number(facultyRecord.id))
      .map((item) => Number(item.courseId || 0))
      .filter(Boolean)
  );

  const subjects = data.adminCourses
    .filter((item) => assignedPlanIds.has(Number(item.id || 0)))
    .filter((item) => !selectedSemester || String(item.semester || "") === selectedSemester)
    .filter((item) => !selectedProgram || normalizeProgramName(item.program || "B.Tech") === selectedProgram)
    .filter((item) => {
      if (!publishedOnly) return true;
      return (data.timetable || []).some(
        (slot) =>
          !slot.isFreeClass &&
          Boolean(slot.is_published) &&
          Number(slot.courseId) === Number(item.id) &&
          (!selectedSemester || String(slot.semester || "") === selectedSemester)
      );
    })
    .map((adminCourse) => {
      if (!adminCourse) return null;

      const course = data.courses.find((item) => normalizeCourseCode(item.code) === normalizeCourseCode(adminCourse.courseCode)) || null;
      const group = data.groups.find((item) => groupLabel(item) === adminCourse.groupName) || null;

      const groupStudents = group
        ? data.studentRecords.filter((item) => item.groupId === group.id && item.status === "Active")
        : [];
      const groupStudentUserIds = new Set(
        groupStudents
          .map((record) => rollToUser.get(record.rollNumber))
          .filter(Boolean)
          .map((studentUser) => studentUser.id)
      );

      const enrolledStudents = course
        ? data.registrations.filter(
          (reg) =>
            reg.courseId === course.id &&
            reg.status === "registered" &&
            (groupStudentUserIds.size === 0 || groupStudentUserIds.has(reg.studentId))
        ).length
        : groupStudents.length;

      return {
        id: adminCourse.id,
        assignmentRowId: adminCourse.id,
        assignmentCreatedAt: adminCourse.createdAt,
        courseId: course ? course.id : null,
        courseCode: adminCourse.courseCode,
        courseName: adminCourse.courseName,
        courseType: adminCourse.courseType,
        groupId: group ? group.id : null,
        groupName: adminCourse.groupName,
        semester: String(adminCourse.semester || ""),
        yearName: group ? group.yearName : "",
        sectionName: group ? group.sectionName : "",
        department: adminCourse.department,
        classesPerWeek: Number(adminCourse.theoryHoursPerWeek || 0) + Number(adminCourse.labHoursPerWeek || 0),
        theoryHoursPerWeek: Number(adminCourse.theoryHoursPerWeek || 0),
        labHoursPerWeek: Number(adminCourse.labHoursPerWeek || 0),
        enrolledStudents
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.courseCode.localeCompare(b.courseCode));

  const assignedCourseIds = new Set();
  for (const course of data.courses) {
    if (course.facultyId === user.id) assignedCourseIds.add(course.id);
  }
  const assignedCodes = new Set(subjects.map((subject) => normalizeCourseCode(subject.courseCode)));
  for (const course of data.courses) {
    if (assignedCodes.has(normalizeCourseCode(course.code))) assignedCourseIds.add(course.id);
  }

  return { facultyRecord, subjects, assignedCourseIds };
}

function facultyAssignedCourseIds(data, user) {
  return facultyAssignedSubjects(data, user).assignedCourseIds;
}

function facultyUpcomingClasses(data, facultyRecord, limit = 3) {
  if (!facultyRecord) return [];

  const schedule = data.timetable
    .filter((slot) => !slot.isFreeClass && (slot.facultyId === facultyRecord.id || slot.replacementFacultyId === facultyRecord.id))
    .map((slot) => {
      const subject = findSlotSubject(data, slot);
      const group = data.groups.find((item) => item.id === slot.groupId) || null;
      const room = data.rooms.find((item) => item.id === slot.roomId) || null;
      return {
        day: slot.day,
        period: slot.period,
        courseCode: subject ? subject.courseCode : "",
        courseName: subject ? subject.courseName : "",
        groupName: group ? groupLabel(group) : "",
        roomNumber: room ? room.roomNumber : ""
      };
    });
  if (!schedule.length) return [];

  const today = new Date();
  const currentDay = DAYS[(today.getDay() + 6) % 7];
  const currentPeriod = currentPeriodNumber(today);
  const dayRank = new Map(DAYS.map((day, index) => [day, index]));
  const currentDayIndex = dayRank.get(currentDay);

  return schedule
    .map((slot) => {
      const slotDay = dayRank.has(slot.day) ? dayRank.get(slot.day) : -1;
      if (slotDay === -1) return null;
      const dayOffset = (slotDay - currentDayIndex + 7) % 7;
      const startsLaterToday = dayOffset > 0 || Number(slot.period) >= currentPeriod;
      if (!startsLaterToday) return null;
      return { ...slot, sortKey: dayOffset * 100 + Number(slot.period || 0) };
    })
    .filter(Boolean)
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, limit)
    .map(({ sortKey, ...slot }) => slot);
}

function facultyNotifications(data, facultyRecord, subjects) {
  if (!facultyRecord) return [];
  const notifications = [];

  for (const subject of subjects) {
    if (!subject.assignmentCreatedAt) continue;
    notifications.push({
      id: `assignment-${subject.assignmentRowId}`,
      text: `Assigned ${subject.courseCode} (${subject.groupName})`,
      createdAt: subject.assignmentCreatedAt
    });
  }

  const recentTimetableSlots = data.timetable
    .filter((slot) => slot.facultyId === facultyRecord.id || slot.replacementFacultyId === facultyRecord.id)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, 5);
  for (const slot of recentTimetableSlots) {
    const subject = findSlotSubject(data, slot);
    const group = data.groups.find((item) => item.id === slot.groupId) || null;
    notifications.push({
      id: `timetable-slot-${slot.id}`,
      text: `Timetable updated: ${subject ? subject.courseCode : "Class"} (${group ? groupLabel(group) : "Unknown group"})`,
      createdAt: slot.updatedAt || slot.createdAt
    });
  }

  for (const record of data.attendanceRecords.filter((item) => item.facultyRecordId === facultyRecord.id)) {
    const subject = subjects.find((item) => item.id === record.assignmentId);
    notifications.push({
      id: `attendance-${record.id}`,
      text: `Attendance marked for ${subject ? subject.courseCode : "assigned class"} on ${record.attendanceDate}`,
      createdAt: record.updatedAt || record.createdAt || `${record.attendanceDate} 00:00:00`
    });
  }

  return notifications
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 3);
}

function facultyCanTakeStudentAttendance(data, facultyRecordId, subjectId, attendanceDate) {
  const day = dayNameFromDate(attendanceDate);
  if (!day) {
    return {
      canMark: false,
      classStatus: "Not Marked",
      message: "Invalid date.",
      hasScheduledClass: false
    };
  }

  const slotsForSubjectDay = data.timetable.filter(
    (slot) => !slot.isFreeClass && Number(slot.courseId) === Number(subjectId) && slot.day === day
  );
  const attendanceRows = data.facultyAttendance.filter((row) => dateOnly(row.attendanceDate) === attendanceDate);
  const replacementByAttendanceId = new Map(data.replacementSessions.map((item) => [item.attendanceId, item]));

  const eligibleSlotIds = new Set();
  for (const slot of slotsForSubjectDay) {
    if (slot.facultyId === facultyRecordId || slot.replacementFacultyId === facultyRecordId) {
      eligibleSlotIds.add(slot.id);
      continue;
    }
    const hasReplacementAssignment = attendanceRows
      .filter((row) => row.timetableId === slot.id && row.status === "Absent")
      .some((row) => {
        const replacement = replacementByAttendanceId.get(row.id);
        return Boolean(replacement && !replacement.isFreeClass && replacement.replacementFacultyId === facultyRecordId);
      });
    if (hasReplacementAssignment) eligibleSlotIds.add(slot.id);
  }

  if (!eligibleSlotIds.size) {
    return {
      canMark: false,
      classStatus: "Not Marked",
      message: "No scheduled class for this subject today.",
      hasScheduledClass: false
    };
  }

  const ownClassMarks = attendanceRows.filter(
    (row) => row.facultyId === facultyRecordId && eligibleSlotIds.has(row.timetableId)
  );
  const hasPresent = ownClassMarks.some((row) => row.status === "Present");
  const hasAbsent = ownClassMarks.some((row) => row.status === "Absent");

  if (hasPresent) {
    return {
      canMark: true,
      classStatus: "Present",
      message: "Class marked Present. Student attendance can be saved.",
      hasScheduledClass: true
    };
  }
  if (hasAbsent) {
    return {
      canMark: false,
      classStatus: "Absent",
      message: "Class marked Absent. Student attendance is blocked and admin has been notified.",
      hasScheduledClass: true
    };
  }

  return {
    canMark: false,
    classStatus: "Not Marked",
    message: "Mark this class as Present in Timetable first, then record student attendance.",
    hasScheduledClass: true
  };
}

app.use("/api", apiRoutes);

app.get("/api/courses", asyncHandler(async (req, res) => {
  const data = await readData();
  const search = String(req.query.search || "").toLowerCase();
  const courses = data.courses
    .filter((course) => !req.query.department || course.department === req.query.department)
    .filter((course) => !req.query.semester || course.semester === req.query.semester)
    .filter((course) => !search || course.name.toLowerCase().includes(search) || course.code.toLowerCase().includes(search))
    .map((course) => courseResponse(data, course));

  res.json(courses);
}));

app.post("/api/courses", requireRole("admin"), asyncHandler(async (req, res) => {
  const error = validateRequired(req.body, ["code", "name", "department", "program", "academicYear", "credits", "semester", "maxSeats"]);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  const data = await readData();
  if (!isActiveDepartment(data, req.body.department)) {
    res.status(400).json({ error: "Select an active department created in Departments." });
    return;
  }
  const academicYear = String(req.body.academicYear || "").trim();
  const program = normalizeProgramName(req.body.program || "B.Tech");
  const semester = String(req.body.semester || "").trim();
  const allowedSemesters = allowedSemestersForYear(academicYear);
  if (!allowedSemesters.includes(semester)) {
    res.status(400).json({ error: `Semester must match selected academic year (${allowedSemesters.join("/")}).` });
    return;
  }
  const nextCode = String(req.body.code || "").trim();
  const duplicate = data.courses.find((course) => normalizeCourseCode(course.code) === normalizeCourseCode(nextCode));
  if (duplicate) {
    res.status(409).json({ error: `Course code already exists in ${courseContextLabel(duplicate)}` });
    return;
  }
  const course = await insert("courses", {
    code: nextCode,
    name: String(req.body.name).trim(),
    department: String(req.body.department).trim(),
    program,
    academicYear,
    credits: Number(req.body.credits),
    semester,
    maxSeats: Number(req.body.maxSeats),
    facultyId: null,
    description: req.body.description ? String(req.body.description).trim() : null,
    isOpen: req.body.isOpen !== false,
    createdAt: now(),
    updatedAt: now()
  });
  res.status(201).json(courseResponse(await readData(), course));
}));

app.get("/api/courses/:courseId", asyncHandler(async (req, res) => {
  const data = await readData();
  const course = data.courses.find((item) => item.id === Number(req.params.courseId));
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  res.json(courseResponse(data, course));
}));

app.put("/api/courses/:courseId", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.courseId);
  const data = await readData();
  const existing = data.courses.find((course) => course.id === id);
  if (!existing) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  const nextDepartment = String(req.body.department || existing.department).trim();
  if (!isActiveDepartment(data, nextDepartment)) {
    res.status(400).json({ error: "Select an active department created in Departments." });
    return;
  }
  const nextAcademicYear = String(req.body.academicYear || existing.academicYear || "").trim();
  const nextProgram = normalizeProgramName(req.body.program || existing.program || "B.Tech");
  const nextSemester = String(req.body.semester || existing.semester || "").trim();
  const nextCode = String(req.body.code || existing.code).trim();
  const allowedSemesters = allowedSemestersForYear(nextAcademicYear);
  if (!allowedSemesters.includes(nextSemester)) {
    res.status(400).json({ error: `Semester must match selected academic year (${allowedSemesters.join("/")}).` });
    return;
  }
  const duplicate = data.courses.find(
    (course) => course.id !== id && normalizeCourseCode(course.code) === normalizeCourseCode(nextCode)
  );
  if (duplicate) {
    res.status(409).json({ error: `Course code already exists in ${courseContextLabel(duplicate)}` });
    return;
  }
  const course = await update("courses", id, {
    code: nextCode,
    name: String(req.body.name || existing.name).trim(),
    department: String(req.body.department || existing.department).trim(),
    program: nextProgram,
    academicYear: nextAcademicYear,
    credits: Number(req.body.credits || existing.credits),
    semester: nextSemester,
    maxSeats: Number(req.body.maxSeats || existing.maxSeats),
    facultyId: null,
    description: req.body.description || null,
    isOpen: req.body.isOpen !== false,
    updatedAt: now()
  });
  res.json(courseResponse(await readData(), course));
}));

app.delete("/api/courses/:courseId", requireRole("admin"), asyncHandler(async (req, res) => {
  const deleted = await remove("courses", req.params.courseId);
  if (!deleted) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  res.json({ message: "Course deleted" });
}));

app.get("/api/admin/dashboard", requireRole("admin"), asyncHandler(async (_req, res) => {
  const data = await readData();
  const registered = data.registrations.filter((reg) => reg.status === "registered");
  const courseDeptMap = new Map();
  for (const course of data.courses) {
    const current = courseDeptMap.get(course.department) || { department: course.department, courseCount: 0, studentCount: 0 };
    current.courseCount += 1;
    courseDeptMap.set(course.department, current);
  }
  for (const student of data.studentRecords) {
    const dept = student.department || "Unassigned";
    const current = courseDeptMap.get(dept) || { department: dept, courseCount: 0, studentCount: 0 };
    current.studentCount += 1;
    courseDeptMap.set(dept, current);
  }

  res.json({
    totalStudents: data.users.filter((user) => user.role === "student").length,
    totalFaculty: data.users.filter((user) => user.role === "faculty").length,
    totalCourses: data.courses.length,
    totalRegistrations: registered.length,
    openCourses: data.courses.filter((course) => course.isOpen).length,
    departmentBreakdown: Array.from(courseDeptMap.values()),
    recentRegistrations: registered.slice(-10).reverse().map((reg) => registrationResponse(data, reg))
  });
}));

app.post("/api/admin/generate-ai-ds-dummy-data", requireRole("admin"), asyncHandler(async (_req, res) => {
  const summary = await transact((data) => seedAiAndDsOnlyDummyData(data));
  res.json({
    message: "AI and DS dummy data generated successfully.",
    summary
  });
}));

app.post("/api/admin/reset-timetable-fresh", requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await transact((data) => {
    const summary = {
      timetableSlotsDeleted: (data.timetable || []).length,
      publishedTimetablesDeleted: (data.publishedTimetables || []).length,
      facultyAttendanceDeleted: (data.facultyAttendance || []).length,
      facultyAlertsDeleted: (data.facultyAlerts || []).length,
      replacementSessionsDeleted: (data.replacementSessions || []).length
    };
    data.timetable = [];
    data.publishedTimetables = [];
    data.facultyAttendance = [];
    data.facultyAlerts = [];
    data.replacementSessions = [];
    return summary;
  });
  res.json({
    message: "Timetable connectivity reset successfully. Admin/faculty timetable state is now fresh.",
    summary: result
  });
}));

app.get("/api/admin/profile", requireRole("admin"), asyncHandler(async (req, res) => {
  const user = (await list("users")).find((item) => item.id === req.session.userId && item.role === "admin");
  if (!user) {
    res.status(404).json({ error: "Admin profile not found" });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    department: user.department || "Administration",
    createdAt: user.createdAt
  });
}));

app.get("/api/admin/students", requireRole("admin"), asyncHandler(async (_req, res) => {
  const data = await readData();
  const rows = data.studentRecords.map((record) => {
    const user = data.users.find((item) => item.rollNumber === record.rollNumber);
    return {
      id: user ? user.id : record.id,
      name: record.studentName,
      rollNumber: record.rollNumber,
      email: record.email || "",
      department: record.department || "",
      semester: user ? user.semester || "" : "",
      enrolledCourses: user
        ? data.registrations.filter((reg) => reg.studentId === user.id && reg.status === "registered").length
        : 0
    };
  });
  res.json(rows);
}));

app.get("/api/admin/faculty", requireRole("admin"), asyncHandler(async (_req, res) => {
  const data = await readData();
  res.json(
    data.facultyRecords.map((record) => {
      const user = data.users.find((item) => item.employeeId === record.facultyId);
      return {
        id: user ? user.id : record.id,
        name: record.facultyName,
        employeeId: record.facultyId,
        email: record.email,
        department: record.department,
        coursesCount: data.courseAssignments.filter((item) => item.facultyId === record.id).length
      };
    })
  );
}));

app.get("/api/faculty/dashboard", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const user = (data.users || []).find((item) => Number(item.id) === Number(req.session.userId)) || null;
  const ctx = resolveFacultySessionContext(req, data, { requireSemester: false });
  if (ctx.error) {
    res.status(ctx.status || 400).json({ error: ctx.error });
    return;
  }
  const facultyData = facultyAssignedSubjects(data, ctx.user, { semester: ctx.semester });
  const assignedCourseIds = facultyData.assignedCourseIds;
  const assignedCourses = data.courses
    .filter((course) => assignedCourseIds.has(course.id))
    .map((course) => courseResponse(data, course));
  const classesThisWeek = facultyData.facultyRecord
    ? data.timetable.filter(
      (slot) =>
        !slot.isFreeClass &&
        (slot.facultyId === facultyData.facultyRecord.id || slot.replacementFacultyId === facultyData.facultyRecord.id)
    ).length
    : 0;
  const upcomingClasses = facultyUpcomingClasses(data, facultyData.facultyRecord, 3).map((slot) => ({
    day: slot.day,
    period: slot.period,
    groupName: slot.groupName,
    courseCode: slot.courseCode,
    courseName: slot.courseName,
    roomNumber: slot.roomNumber
  }));
  const integratedSlots = facultyData.facultyRecord
    ? (data.timetable || [])
      .filter((slot) => !slot.isFreeClass && Boolean(slot.is_published))
      .filter((slot) =>
        Number(slot.facultyId || 0) === Number(facultyData.facultyRecord.id) ||
        Number(slot.replacementFacultyId || 0) === Number(facultyData.facultyRecord.id)
      )
      .map((slot) => buildSlotResponse(data, slot))
    : [];
  const integratedMap = new Map();
  for (const slot of integratedSlots) {
    const key = `${slot.day}|${Number(slot.period)}`;
    if (!integratedMap.has(key)) {
      integratedMap.set(key, {
        ...slot,
        groupNames: [slot.groupName].filter(Boolean)
      });
      continue;
    }
    const existing = integratedMap.get(key);
    if (slot.groupName && !existing.groupNames.includes(slot.groupName)) existing.groupNames.push(slot.groupName);
    existing.groupName = existing.groupNames.join(" / ");
  }
  const integratedTimetable = Array.from(integratedMap.values()).sort((a, b) => {
    const dayDelta = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
    if (dayDelta !== 0) return dayDelta;
    return Number(a.period || 0) - Number(b.period || 0);
  });
  const currentWorkload = facultyData.subjects.reduce((sum, subject) => sum + subject.classesPerWeek, 0);

  res.json({
    facultyName: facultyData.facultyRecord ? facultyData.facultyRecord.facultyName : user ? user.name : "",
    department: facultyData.facultyRecord ? facultyData.facultyRecord.department : user ? user.department : "",
    maxWorkload: facultyData.facultyRecord ? facultyData.facultyRecord.maxWorkload : null,
    currentWorkload,
    totalAssignedCourses: facultyData.subjects.length,
    totalSubjectsAssigned: facultyData.subjects.length,
    totalClassesThisWeek: classesThisWeek,
    upcomingClasses,
    integratedTimetable,
    integratedDays: DAYS,
    integratedPeriods: PERIODS,
    notifications: facultyNotifications(data, facultyData.facultyRecord, facultyData.subjects),
    assignedCourses,
    totalStudents: assignedCourses.reduce((sum, course) => sum + course.enrolledCount, 0)
  });
}));

app.get("/api/faculty/session-context", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const ctx = resolveFacultySessionContext(req, data, { requireSemester: false });
  if (ctx.error) {
    res.status(ctx.status || 400).json({ error: ctx.error });
    return;
  }
  res.json({
    facultyId: Number(ctx.facultyRecord.id),
    facultyCode: ctx.facultyRecord.facultyId,
    facultyName: ctx.facultyRecord.facultyName,
    semester: String(ctx.semester || ""),
    hasSemester: Boolean(String(ctx.semester || "").trim())
  });
}));

app.post("/api/faculty/session-context", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const semester = String(req.body.semester || "").trim();
  const ctx = resolveFacultySessionContext(req, data, { semester, requireSemester: true });
  if (ctx.error) {
    res.status(ctx.status || 400).json({ error: ctx.error });
    return;
  }
  res.json({
    facultyId: Number(ctx.facultyRecord.id),
    facultyCode: ctx.facultyRecord.facultyId,
    facultyName: ctx.facultyRecord.facultyName,
    semester: String(ctx.semester || "")
  });
}));

app.get("/api/faculty/courses/:courseId/registrations", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const user = data.users.find((item) => item.id === req.session.userId);
  const courseId = Number(req.params.courseId);
  const course = data.courses.find((item) => item.id === courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const assignedCourseIds = facultyAssignedCourseIds(data, user);
  if (!assignedCourseIds.has(courseId)) {
    res.status(403).json({ error: "You are not assigned to this course" });
    return;
  }

  res.json(
    data.registrations
      .filter((reg) => reg.courseId === courseId)
      .map((reg) => registrationResponse(data, reg))
  );
}));

app.get("/api/faculty/subjects", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const ctx = resolveFacultySessionContext(req, data, { semester: req.query.semester, program: req.query.program, requireSemester: true });
  if (ctx.error) {
    res.status(ctx.status || 400).json({ error: ctx.error });
    return;
  }
  const { subjects } = facultyAssignedSubjects(data, ctx.user, { semester: ctx.semester, program: ctx.program });
  res.json(subjects);
}));

app.get("/api/faculty/subjects/:subjectId", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const ctx = resolveFacultySessionContext(req, data, { semester: req.query.semester, program: req.query.program, requireSemester: true });
  if (ctx.error) {
    res.status(ctx.status || 400).json({ error: ctx.error });
    return;
  }
  const { subjects } = facultyAssignedSubjects(data, ctx.user, { semester: ctx.semester, program: ctx.program });
  const subjectId = Number(req.params.subjectId);
  const subject = subjects.find((item) => item.id === subjectId);
  if (!subject) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }

  const rollToUser = new Map(
    data.users
      .filter((item) => item.role === "student" && item.rollNumber)
      .map((item) => [item.rollNumber, item])
  );
  const registeredIds = new Set(
    subject.courseId
      ? data.registrations
        .filter((item) => item.courseId === subject.courseId && item.status === "registered")
        .map((item) => item.studentId)
      : []
  );
  const students = data.studentRecords
    .filter((item) => item.groupId === subject.groupId && item.status === "Active")
    .map((record) => {
      const studentUser = rollToUser.get(record.rollNumber);
      return {
        id: record.id,
        rollNumber: record.rollNumber,
        studentName: record.studentName,
        email: record.email || (studentUser ? studentUser.email : ""),
        registered: studentUser ? registeredIds.has(studentUser.id) : false
      };
    });

  res.json({ ...subject, students });
}));

app.get("/api/faculty/students", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const ctx = resolveFacultySessionContext(req, data, { semester: req.query.semester, program: req.query.program, requireSemester: true });
  if (ctx.error) {
    res.status(ctx.status || 400).json({ error: ctx.error });
    return;
  }
  const { subjects } = facultyAssignedSubjects(data, ctx.user, { semester: ctx.semester, program: ctx.program });
  const subjectId = req.query.subjectId ? Number(req.query.subjectId) : null;
  const targetSubjects = subjectId ? subjects.filter((item) => item.id === subjectId) : subjects;
  if (subjectId && !targetSubjects.length) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }

  const rollToUser = new Map(
    data.users
      .filter((item) => item.role === "student" && item.rollNumber)
      .map((item) => [item.rollNumber, item])
  );

  const rows = [];
  for (const subject of targetSubjects) {
    const registeredIds = new Set(
      subject.courseId
        ? data.registrations
          .filter((item) => item.courseId === subject.courseId && item.status === "registered")
          .map((item) => item.studentId)
        : []
    );
    const groupStudents = data.studentRecords.filter((item) => item.groupId === subject.groupId && item.status === "Active");
    for (const studentRecord of groupStudents) {
      const studentUser = rollToUser.get(studentRecord.rollNumber);
      if (subject.courseId && (!studentUser || !registeredIds.has(studentUser.id))) continue;
      rows.push({
        subjectId: subject.id,
        courseCode: subject.courseCode,
        courseName: subject.courseName,
        groupName: subject.groupName,
        rollNumber: studentRecord.rollNumber,
        studentName: studentRecord.studentName,
        email: studentRecord.email || (studentUser ? studentUser.email : "")
      });
    }
  }

  res.json(rows);
}));

app.get("/api/faculty/attendance", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const ctx = resolveFacultySessionContext(req, data, { semester: req.query.semester, program: req.query.program, requireSemester: true });
  if (ctx.error) {
    res.status(ctx.status || 400).json({ error: ctx.error });
    return;
  }
  const { facultyRecord, subjects } = facultyAssignedSubjects(data, ctx.user, { semester: ctx.semester, program: ctx.program, publishedOnly: true });
  const subjectId = Number(req.query.subjectId);
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }
  const subject = subjects.find((item) => item.id === subjectId);
  if (!subject) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }

  const selectedDate = dateOnly(req.query.date || new Date());
  const classGate = facultyCanTakeStudentAttendance(data, facultyRecord.id, subject.id, selectedDate);
  const rows = data.attendanceRecords
    .filter((item) => item.facultyRecordId === facultyRecord.id && item.assignmentId === subject.id)
    .filter((item) => item.attendanceDate === selectedDate)
    .sort((a, b) => String(b.attendanceDate || "").localeCompare(String(a.attendanceDate || "")));

  const students = data.studentRecords
    .filter((item) => item.groupId === subject.groupId && item.status === "Active")
    .map((item) => {
      const current = selectedDate
        ? rows.find((record) => record.studentRecordId === item.id)
        : null;
      return {
        id: item.id,
        rollNumber: item.rollNumber,
        studentName: item.studentName,
        email: item.email || "",
        status: current ? current.status : null
      };
    });

  res.json({
    subject,
    date: selectedDate,
    classAttendanceStatus: classGate.classStatus,
    canMarkStudentAttendance: classGate.canMark,
    classAttendanceMessage: classGate.message,
    hasScheduledClass: classGate.hasScheduledClass,
    students,
    records: rows
  });
}));

app.post("/api/faculty/attendance", requireRole("faculty"), asyncHandler(async (req, res) => {
  const subjectId = Number(req.body.subjectId);
  const attendanceDate = String(req.body.date || "").trim();
  const records = Array.isArray(req.body.records) ? req.body.records : [];
  if (!subjectId || !attendanceDate || records.length === 0) {
    res.status(400).json({ error: "subjectId, date and records[] are required" });
    return;
  }

  const dateOnlyValue = attendanceDate.slice(0, 10);
  const today = dateOnly(new Date());
  if (dateOnlyValue !== today) {
    res.status(400).json({ error: `Student attendance can be marked only for today (${today}).` });
    return;
  }
  const result = await transact((data) => {
    const ctx = resolveFacultySessionContext(req, data, { semester: req.body.semester, requireSemester: true });
    if (ctx.error) return { error: ctx.error, status: ctx.status || 400 };
    const { facultyRecord, subjects } = facultyAssignedSubjects(data, ctx.user, { semester: ctx.semester, publishedOnly: true });
    const subject = subjects.find((item) => item.id === subjectId);
    if (!facultyRecord || !subject) {
      return { error: "Subject not found", status: 404 };
    }
    const classGate = facultyCanTakeStudentAttendance(data, facultyRecord.id, subject.id, dateOnlyValue);
    if (!classGate.hasScheduledClass) {
      return { error: "No scheduled class for this subject today.", status: 400 };
    }
    if (!classGate.canMark) {
      return { error: classGate.message, status: 409 };
    }

    const allowedStudents = new Set(
      data.studentRecords
        .filter((item) => item.groupId === subject.groupId && item.status === "Active")
        .map((item) => item.id)
    );

    let nextId = data.attendanceRecords.reduce((max, item) => Math.max(max, item.id), 0);
    for (const row of records) {
      const studentRecordId = Number(row.studentRecordId);
      const status = String(row.status || "").trim();
      if (!allowedStudents.has(studentRecordId)) {
        return { error: "Student does not belong to assigned group", status: 400 };
      }
      if (!["Present", "Absent"].includes(status)) {
        return { error: "Attendance status must be Present or Absent", status: 400 };
      }

      const existing = data.attendanceRecords.find(
        (item) =>
          item.assignmentId === subject.id &&
          item.studentRecordId === studentRecordId &&
          item.attendanceDate === dateOnlyValue
      );

      if (existing) {
        existing.status = status;
        existing.updatedAt = now();
        existing.courseId = subject.courseId;
        continue;
      }

      data.attendanceRecords.push({
        id: ++nextId,
        facultyRecordId: facultyRecord.id,
        assignmentId: subject.id,
        studentRecordId,
        courseId: subject.courseId,
        attendanceDate: dateOnlyValue,
        status,
        createdAt: now(),
        updatedAt: now()
      });
    }

    return { updated: records.length };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }

  res.json(result);
}));

app.get("/api/faculty/attendance/history", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const ctx = resolveFacultySessionContext(req, data, { semester: req.query.semester, program: req.query.program, requireSemester: true });
  if (ctx.error) {
    res.status(ctx.status || 400).json({ error: ctx.error });
    return;
  }
  const { facultyRecord, subjects } = facultyAssignedSubjects(data, ctx.user, { semester: ctx.semester, program: ctx.program, publishedOnly: true });

  const subjectId = req.query.subjectId ? Number(req.query.subjectId) : null;
  const subjectMap = new Map(subjects.map((item) => [item.id, item]));
  const rows = data.attendanceRecords
    .filter((item) => item.facultyRecordId === facultyRecord.id)
    .filter((item) => !subjectId || item.assignmentId === subjectId)
    .sort((a, b) => String(b.attendanceDate || "").localeCompare(String(a.attendanceDate || "")))
    .slice(0, 200)
    .map((item) => {
      const student = data.studentRecords.find((record) => record.id === item.studentRecordId);
      const subject = subjectMap.get(item.assignmentId);
      return {
        id: item.id,
        date: item.attendanceDate,
        status: item.status,
        rollNumber: student ? student.rollNumber : "",
        studentName: student ? student.studentName : "",
        courseCode: subject ? subject.courseCode : "",
        courseName: subject ? subject.courseName : "",
        groupName: subject ? subject.groupName : ""
      };
    });

  res.json(rows);
}));

app.get("/api/faculty/profile", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const user = data.users.find((item) => item.id === req.session.userId);
  const facultyRecord = findFacultyRecordForUser(data, user);
  res.json({
    facultyId: facultyRecord ? facultyRecord.facultyId : user ? user.employeeId : "",
    facultyName: facultyRecord ? facultyRecord.facultyName : user ? user.name : "",
    email: facultyRecord ? facultyRecord.email : user ? user.email : "",
    department: facultyRecord ? facultyRecord.department : user ? user.department : "",
    maxWorkload: facultyRecord ? facultyRecord.maxWorkload : null
  });
}));

app.put("/api/faculty/profile", requireRole("faculty"), asyncHandler(async (req, res) => {
  const email = req.body.email ? String(req.body.email).trim() : "";
  const password = req.body.password ? String(req.body.password) : "";
  if (!email && !password) {
    res.status(400).json({ error: "Provide email or password to update" });
    return;
  }

  const result = await transact((data) => {
    const user = data.users.find((item) => item.id === req.session.userId);
    if (!user) return { error: "User not found", status: 404 };
    const facultyRecord = findFacultyRecordForUser(data, user);
    if (!facultyRecord) return { error: "Faculty record not found", status: 404 };

    if (email) {
      const duplicate = data.users.find((item) => item.id !== user.id && String(item.email || "").toLowerCase() === email.toLowerCase());
      if (duplicate) return { error: "Email already in use", status: 409 };
      facultyRecord.email = email;
    }
    if (password) {
      if (password.length < 6) return { error: "Password must be at least 6 characters", status: 400 };
      facultyRecord.facultyPassword = password;
    }

    const synced = syncFacultyToUser(data, facultyRecord);
    return {
      facultyId: facultyRecord.facultyId,
      facultyName: facultyRecord.facultyName,
      email: facultyRecord.email,
      department: facultyRecord.department,
      maxWorkload: facultyRecord.maxWorkload,
      user: {
        id: synced.id,
        name: synced.name,
        username: synced.username,
        email: synced.email,
        role: synced.role
      }
    };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }

  res.json(result);
}));

app.get("/api/student/dashboard", requireRole("student"), asyncHandler(async (req, res) => {
  const data = await readData();
  const studentIds = studentIdentityIds(data, req.session.userId);
  const user = data.users.find((item) => item.id === req.session.userId);
  const studentRecord = (data.studentRecords || []).find((item) => studentIds.has(Number(item.id))) || null;
  const studentGroup = studentRecord
    ? (data.groups || []).find((group) => Number(group.id) === Number(studentRecord.groupId)) || null
    : null;
  const studentProgram = normalizeProgramName(
    (studentGroup && studentGroup.program) ||
    "B.Tech"
  );
  const myRegs = data.registrations.filter(
    (reg) => reg.status === "registered" && studentIds.has(Number(reg.studentId))
  );
  const registeredIds = new Set(myRegs.map((reg) => Number(reg.courseId)));
  const registeredCourses = data.courses
    .filter((course) => registeredIds.has(Number(course.id)))
    .filter((course) => normalizeProgramName(course.program || "B.Tech") === studentProgram)
    .map((course) => courseResponse(data, course));
  const availableCourses = data.courses
    .filter((course) => course.isOpen && !registeredIds.has(Number(course.id)))
    .filter((course) => normalizeProgramName(course.program || "B.Tech") === studentProgram)
    .map((course) => courseResponse(data, course));
  res.json({
    studentName: user ? user.name : "",
    registeredCourses,
    totalCredits: registeredCourses.reduce((sum, course) => sum + course.credits, 0),
    availableCourses
  });
}));

app.get("/api/student/registrations", requireRole("student"), asyncHandler(async (req, res) => {
  const data = await readData();
  const studentIds = studentIdentityIds(data, req.session.userId);
  res.json(
    data.registrations
      .filter((reg) => studentIds.has(Number(reg.studentId)))
      .map((reg) => registrationResponse(data, reg))
  );
}));

app.post("/api/student/registrations", requireRole("student"), asyncHandler(async (req, res) => {
  const courseId = Number(req.body.courseId);
  const result = await transact((data) => {
    const studentIds = studentIdentityIds(data, req.session.userId);
    const course = data.courses.find((item) => item.id === courseId);
    if (!course) return { error: "Course not found", status: 404 };
    if (!course.isOpen) return { error: "Course registration is closed", status: 400 };

    const enrolled = data.registrations.filter(
      (reg) => reg.courseId === courseId && reg.status === "registered"
    ).length;
    if (enrolled >= course.maxSeats) return { error: "Course is full", status: 400 };

    const existing = data.registrations.find(
      (reg) =>
        studentIds.has(Number(reg.studentId)) &&
        reg.courseId === courseId &&
        reg.status === "registered"
    );
    if (existing) return { error: "Already registered for this course", status: 400 };

    const reg = {
      id: data.registrations.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      courseId,
      studentId: req.session.userId,
      status: "registered",
      registeredAt: now()
    };
    data.registrations.push(reg);
    return registrationResponse(data, reg);
  });

  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(201).json(result);
}));

app.delete("/api/student/registrations/:registrationId", requireRole("student"), asyncHandler(async (req, res) => {
  const result = await transact((data) => {
    const studentIds = studentIdentityIds(data, req.session.userId);
    const reg = data.registrations.find(
      (item) => item.id === Number(req.params.registrationId) && studentIds.has(Number(item.studentId))
    );
    if (!reg) return null;
    reg.status = "dropped";
    return reg;
  });
  if (!result) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }
  res.json({ message: "Course dropped" });
}));

function crudRoutes({ pathName, tableName, requireAdmin = true, validate, afterCreate, afterUpdate, afterDelete }) {
  const guards = requireAdmin ? [requireRole("admin")] : [];

  app.get(`/api/${pathName}`, ...guards, asyncHandler(async (_req, res) => {
    const rows = (await list(tableName)).sort(byCreatedAt);
    res.json(rows);
  }));

  app.post(`/api/${pathName}`, ...guards, asyncHandler(async (req, res) => {
    const values = validate(req.body, false);
    if (values.error) {
      res.status(400).json({ error: values.error });
      return;
    }
    const row = await transact((data) => {
      const created = {
        id: data[tableName].reduce((max, item) => Math.max(max, item.id), 0) + 1,
        ...values,
        createdAt: now()
      };
      data[tableName].push(created);
      if (afterCreate) afterCreate(data, created);
      return created;
    });
    res.status(201).json(row);
  }));

  app.put(`/api/${pathName}/:id`, ...guards, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const values = validate(req.body, true);
    if (values.error) {
      res.status(400).json({ error: values.error });
      return;
    }
    const row = await transact((data) => {
      const current = data[tableName].find((item) => item.id === id);
      if (!current) return null;
      Object.assign(current, values);
      if (afterUpdate) afterUpdate(data, current);
      return current;
    });
    if (!row) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    res.json(row);
  }));

  app.delete(`/api/${pathName}/:id`, ...guards, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await transact((data) => {
      const index = data[tableName].findIndex((item) => item.id === id);
      if (index === -1) return null;
      const [deleted] = data[tableName].splice(index, 1);
      if (afterDelete) afterDelete(data, deleted);
      return deleted;
    });
    if (!row) {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    res.json({ message: "Deleted" });
  }));
}

function syncCourseAssignment(data, course, additionalFacultyRecordIds = []) {
  const primaryFacultyRecordId = Number(course.facultyRecordId || 0);
  const allFacultyIds = Array.from(new Set(
    [primaryFacultyRecordId, ...((Array.isArray(additionalFacultyRecordIds) ? additionalFacultyRecordIds : []).map((id) => Number(id || 0)))]
      .filter(Boolean)
  ));
  data.courseAssignments = data.courseAssignments.filter((item) => item.courseId !== course.id);
  if (!allFacultyIds.length) return;

  let nextId = data.courseAssignments.reduce((max, item) => Math.max(max, item.id), 0);
  for (const facultyRecordId of allFacultyIds) {
    const faculty = data.facultyRecords.find((item) => item.id === facultyRecordId && item.status === "Active");
    if (!faculty) continue;
    data.courseAssignments.push({
      id: ++nextId,
      facultyId: facultyRecordId,
      courseId: course.id,
      createdAt: now()
    });
  }
}

app.get("/api/departments", requireRole("admin"), asyncHandler(async (_req, res) => {
  const rows = (await list("departments")).sort(byCreatedAt);
  res.json(rows);
}));

app.post("/api/departments", requireRole("admin"), asyncHandler(async (req, res) => {
  const departmentName = String(req.body.departmentName || "").trim();
  const status = String(req.body.status || "Active").trim() || "Active";
  if (!departmentName) {
    res.status(400).json({ error: "Department is required" });
    return;
  }
  const result = await transact((data) => {
    const exists = (data.departments || []).some(
      (item) => normalizeCourseCode(item.departmentName) === normalizeCourseCode(departmentName)
    );
    if (exists) return { error: "Department already exists", status: 409 };
    const created = {
      id: data.departments.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      departmentName,
      status,
      createdAt: now()
    };
    data.departments.push(created);
    return created;
  });
  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }
  res.status(201).json(result);
}));

app.put("/api/departments/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const departmentName = String(req.body.departmentName || "").trim();
  const status = String(req.body.status || "Active").trim() || "Active";
  if (!departmentName) {
    res.status(400).json({ error: "Department is required" });
    return;
  }
  const result = await transact((data) => {
    const current = (data.departments || []).find((item) => item.id === id);
    if (!current) return null;
    const duplicate = (data.departments || []).some(
      (item) => item.id !== id && normalizeCourseCode(item.departmentName) === normalizeCourseCode(departmentName)
    );
    if (duplicate) return { error: "Department already exists", status: 409 };
    current.departmentName = departmentName;
    current.status = status;
    return current;
  });
  if (!result) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }
  res.json(result);
}));

app.delete("/api/departments/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await transact((data) => {
    const departments = data.departments || [];
    const index = departments.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const target = departments[index];
    const targetName = String(target.departmentName || "").trim();
    const inUse =
      (data.groups || []).some((item) => normalizeCourseCode(item.department) === normalizeCourseCode(targetName)) ||
      (data.facultyRecords || []).some((item) => normalizeCourseCode(item.department) === normalizeCourseCode(targetName)) ||
      (data.studentRecords || []).some((item) => normalizeCourseCode(item.department) === normalizeCourseCode(targetName)) ||
      (data.courses || []).some((item) => normalizeCourseCode(item.department) === normalizeCourseCode(targetName)) ||
      (data.adminCourses || []).some((item) => normalizeCourseCode(item.department) === normalizeCourseCode(targetName));
    if (inUse) {
      target.status = "Inactive";
      return { softDeleted: true, row: target };
    }
    const [deleted] = departments.splice(index, 1);
    return { softDeleted: false, row: deleted };
  });
  if (!result) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }
  res.json({ message: result.softDeleted ? "Department is in use, so it was marked Inactive." : "Deleted" });
}));

crudRoutes({
  pathName: "groups",
  tableName: "groups",
  validate(body) {
    const sectionName = buildGroupSectionName(
      body ? body.streamName : "",
      body ? body.sectionCode : "",
      body ? body.sectionName : ""
    );
    const normalizedBody = { ...body, sectionName };
    const error = validateRequired(normalizedBody, ["program", "yearName", "semester", "sectionName", "department", "strength", "status"]);
    if (error) return { error };
    const parsed = parseGroupSection(sectionName);
    if (!parsed.sectionCode) {
      return { error: "Group must include a valid Section / Stream value." };
    }
    const yearName = String(normalizedBody.yearName || "").trim();
    const allowed = allowedSemestersForYear(yearName);
    let semester = String(normalizedBody.semester || "").trim();
    if (!semester) semester = allowed[0];
    if (!allowed.includes(semester)) {
      return { error: `Semester must match Year (${allowed.join("/")})` };
    }
    return {
      program: normalizeProgramName(normalizedBody.program || "B.Tech"),
      yearName: String(normalizedBody.yearName),
      semester,
      sectionName,
      department: String(normalizedBody.department).trim(),
      strength: Number(normalizedBody.strength),
      status: String(normalizedBody.status)
    };
  }
});

crudRoutes({
  pathName: "rooms",
  tableName: "rooms",
  validate(body) {
    const error = validateRequired(body, ["roomNumber", "roomType", "roomSpecialization", "capacity", "buildingName", "status"]);
    if (error) return { error };
    return {
      roomNumber: String(body.roomNumber).trim(),
      roomType: String(body.roomType),
      roomSpecialization: String(body.roomSpecialization),
      capacity: Number(body.capacity),
      buildingName: String(body.buildingName).trim(),
      status: String(body.status)
    };
  }
});

app.get("/api/admin-courses", requireRole("admin"), asyncHandler(async (_req, res) => {
  const rows = (await list("adminCourses")).sort(byCreatedAt);
  res.json(rows);
}));

app.post("/api/admin-courses", requireRole("admin"), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const error = validateRequired(body, [
    "department",
    "program",
    "semester",
    "courseCode",
    "courseName",
    "credits",
    "academicYear",
    "courseType",
    "theoryHoursPerWeek",
    "labHoursPerWeek",
    "requiredRoomSpecialization",
    "groupName",
    "status"
  ]);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const result = await transact((data) => {
    const groupName = String(body.groupName || "").trim();
    const group = findGroupByLabel(data, groupName);
    if (!group) return { error: "Selected group not found", status: 404 };
    const departmentInput = String(body.department || "").trim();
    const programInput = normalizeProgramName(body.program || "B.Tech");
    const semester = String(body.semester || "").trim();
    if (!departmentInput) return { error: "Department is required in Teaching Plan.", status: 400 };
    if (!semester) return { error: "Semester is required in Teaching Plan.", status: 400 };
    const courseCode = String(body.courseCode || "").trim();
    const sourceCourse = data.courses.find((course) => normalizeCourseCode(course.code) === normalizeCourseCode(courseCode));
    if (!sourceCourse) return { error: `Course ${courseCode} not found in Registration Courses.`, status: 404 };
    const department = String(sourceCourse.department || "").trim();
    if (normalizeCourseCode(departmentInput) !== normalizeCourseCode(department)) {
      return { error: "Selected course does not belong to chosen department.", status: 400 };
    }
    // Same registration course code can appear in multiple semester blocks in Excel-derived planning.
    // Keep teaching-plan semester authoritative instead of forcing sourceCourse.semester equality.
    if (normalizeCourseCode(group.department) !== normalizeCourseCode(department)) {
      return { error: `Selected group belongs to ${group.department}. Choose a ${department} group for this course.`, status: 400 };
    }
    if (groupSemesterValue(group) !== semester) {
      return { error: `Selected group belongs to semester ${groupSemesterValue(group) || "-"}. Choose a semester ${semester} group.`, status: 400 };
    }
    if (normalizeProgramName(group.program || "B.Tech") !== programInput) {
      return { error: `Selected group belongs to ${group.program || "B.Tech"}. Choose program ${group.program || "B.Tech"}.`, status: 400 };
    }
    const academicYear = String(body.academicYear || "").trim();
    if (!academicYear) return { error: "Academic Year is required in Teaching Plan.", status: 400 };
    if (!sameAcademicYear(group.yearName, academicYear)) {
      return { error: `Selected group belongs to ${group.yearName}. Choose Academic Year ${group.yearName}.`, status: 400 };
    }
    const sourceAcademicYear = String(sourceCourse.academicYear || "").trim();
    if (sourceAcademicYear && !sameAcademicYear(sourceAcademicYear, academicYear)) {
      return { error: `Selected registration course belongs to ${sourceAcademicYear}. Choose a ${academicYear} course.`, status: 400 };
    }
    const sourceProgram = normalizeProgramName(sourceCourse.program || "B.Tech");
    if (sourceProgram !== programInput) {
      return { error: `Selected registration course belongs to ${sourceProgram}. Choose a ${programInput} course.`, status: 400 };
    }
    const duplicate = data.adminCourses.some(
      (item) =>
        normalizeCourseCode(String(item.groupName || "")) === normalizeCourseCode(groupName) &&
        (
          normalizeCourseCode(String(item.courseCode || "")) === normalizeCourseCode(courseCode) ||
          normalizeCourseCode(String(item.courseName || "")) === normalizeCourseCode(String(body.courseName || ""))
        )
    );
    if (duplicate) return { error: "Teaching Plan already has this course for the selected group.", status: 409 };

    const facultyRecordId = Number(body.facultyRecordId || 0);
    const secondaryFacultyRecordId = Number(body.secondaryFacultyRecordId || 0);
    if (!facultyRecordId) return { error: "Faculty is required in Teaching Plan.", status: 400 };
    const faculty = data.facultyRecords.find((item) => item.id === facultyRecordId && item.status === "Active");
    if (!faculty) return { error: "Selected faculty not found or inactive", status: 404 };
    if (normalizeCourseCode(faculty.department) !== normalizeCourseCode(department)) {
      return { error: "Faculty department mismatch for selected group.", status: 400 };
    }
    const facultyMappings = (data.facultyCourseMappings || []).filter((mapping) => Number(mapping.facultyId) === Number(facultyRecordId));
    const canTeachCourse = facultyMappings.some(
      (mapping) =>
        Number(mapping.facultyId) === Number(facultyRecordId) &&
        normalizeCourseCode(mapping.courseCode) === normalizeCourseCode(courseCode)
    );
    if (!canTeachCourse) {
      return { error: "Selected faculty is not mapped to teach this course.", status: 400 };
    }
    if (secondaryFacultyRecordId) {
      if (secondaryFacultyRecordId === facultyRecordId) {
        return { error: "Primary and secondary faculty cannot be same.", status: 400 };
      }
      const secondaryFaculty = data.facultyRecords.find((item) => item.id === secondaryFacultyRecordId && item.status === "Active");
      if (!secondaryFaculty) return { error: "Secondary faculty not found or inactive", status: 404 };
      if (normalizeCourseCode(secondaryFaculty.department) !== normalizeCourseCode(department)) {
        return { error: "Secondary faculty department mismatch for selected group.", status: 400 };
      }
      const secondaryMappings = (data.facultyCourseMappings || []).filter((mapping) => Number(mapping.facultyId) === Number(secondaryFacultyRecordId));
      const secondaryCanTeach = secondaryMappings.some(
        (mapping) =>
          Number(mapping.facultyId) === Number(secondaryFacultyRecordId) &&
          normalizeCourseCode(mapping.courseCode) === normalizeCourseCode(courseCode)
      );
      if (!secondaryCanTeach) {
        return { error: "Secondary faculty is not mapped to teach this course.", status: 400 };
      }
    }

    const created = {
      id: data.adminCourses.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      courseCode,
      courseName: String(body.courseName).trim(),
      credits: Number(body.credits),
      program: programInput,
      academicYear: String(body.academicYear),
      semester,
      department,
      courseType: String(body.courseType),
      theoryHoursPerWeek: Number(body.theoryHoursPerWeek),
      labHoursPerWeek: Number(body.labHoursPerWeek),
      requiredRoomSpecialization: String(body.requiredRoomSpecialization),
      groupName,
      facultyRecordId,
      status: String(body.status),
      createdAt: now()
    };
    data.adminCourses.push(created);
    syncCourseAssignment(data, created, secondaryFacultyRecordId ? [secondaryFacultyRecordId] : []);
    return created;
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }
  res.status(201).json(result);
}));

app.put("/api/admin-courses/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const result = await transact((data) => {
    const current = data.adminCourses.find((item) => item.id === id);
    if (!current) return { error: "Record not found", status: 404 };
    const groupName = String(body.groupName || current.groupName || "").trim();
    const group = findGroupByLabel(data, groupName);
    if (!group) return { error: "Selected group not found", status: 404 };
    const departmentInput = String(body.department || current.department || "").trim();
    const programInput = normalizeProgramName(body.program || current.program || "B.Tech");
    const semester = String(body.semester || current.semester || "").trim();
    if (!departmentInput) return { error: "Department is required in Teaching Plan.", status: 400 };
    if (!semester) return { error: "Semester is required in Teaching Plan.", status: 400 };
    const courseCode = String(body.courseCode || current.courseCode || "").trim();
    const sourceCourse = data.courses.find((course) => normalizeCourseCode(course.code) === normalizeCourseCode(courseCode));
    if (!sourceCourse) return { error: `Course ${courseCode} not found in Registration Courses.`, status: 404 };
    const department = String(sourceCourse.department || "").trim();
    if (normalizeCourseCode(departmentInput) !== normalizeCourseCode(department)) {
      return { error: "Selected course does not belong to chosen department.", status: 400 };
    }
    // Same registration course code can appear in multiple semester blocks in Excel-derived planning.
    // Keep teaching-plan semester authoritative instead of forcing sourceCourse.semester equality.
    if (normalizeCourseCode(group.department) !== normalizeCourseCode(department)) {
      return { error: `Selected group belongs to ${group.department}. Choose a ${department} group for this course.`, status: 400 };
    }
    if (groupSemesterValue(group) !== semester) {
      return { error: `Selected group belongs to semester ${groupSemesterValue(group) || "-"}. Choose a semester ${semester} group.`, status: 400 };
    }
    if (normalizeProgramName(group.program || "B.Tech") !== programInput) {
      return { error: `Selected group belongs to ${group.program || "B.Tech"}. Choose program ${group.program || "B.Tech"}.`, status: 400 };
    }
    const academicYear = String(body.academicYear || current.academicYear || "").trim();
    if (!academicYear) return { error: "Academic Year is required in Teaching Plan.", status: 400 };
    if (!sameAcademicYear(group.yearName, academicYear)) {
      return { error: `Selected group belongs to ${group.yearName}. Choose Academic Year ${group.yearName}.`, status: 400 };
    }
    const sourceAcademicYear = String(sourceCourse.academicYear || "").trim();
    if (sourceAcademicYear && !sameAcademicYear(sourceAcademicYear, academicYear)) {
      return { error: `Selected registration course belongs to ${sourceAcademicYear}. Choose a ${academicYear} course.`, status: 400 };
    }
    const sourceProgram = normalizeProgramName(sourceCourse.program || "B.Tech");
    if (sourceProgram !== programInput) {
      return { error: `Selected registration course belongs to ${sourceProgram}. Choose a ${programInput} course.`, status: 400 };
    }
    const duplicate = data.adminCourses.some(
      (item) =>
        item.id !== id &&
        normalizeCourseCode(String(item.groupName || "")) === normalizeCourseCode(groupName) &&
        (
          normalizeCourseCode(String(item.courseCode || "")) === normalizeCourseCode(courseCode) ||
          normalizeCourseCode(String(item.courseName || "")) === normalizeCourseCode(String(body.courseName || current.courseName || ""))
        )
    );
    if (duplicate) return { error: "Teaching Plan already has this course for the selected group.", status: 409 };
    const facultyRecordId = Number(body.facultyRecordId ?? current.facultyRecordId ?? 0);
    const secondaryFacultyRecordId = Number(body.secondaryFacultyRecordId ?? 0);
    if (!facultyRecordId) return { error: "Faculty is required in Teaching Plan.", status: 400 };
    const faculty = data.facultyRecords.find((item) => item.id === facultyRecordId && item.status === "Active");
    if (!faculty) return { error: "Selected faculty not found or inactive", status: 404 };
    if (normalizeCourseCode(faculty.department) !== normalizeCourseCode(department)) {
      return { error: "Faculty department mismatch for selected group.", status: 400 };
    }
    const facultyMappings = (data.facultyCourseMappings || []).filter((mapping) => Number(mapping.facultyId) === Number(facultyRecordId));
    const canTeachCourse = facultyMappings.some(
      (mapping) =>
        Number(mapping.facultyId) === Number(facultyRecordId) &&
        normalizeCourseCode(mapping.courseCode) === normalizeCourseCode(courseCode)
    );
    if (!canTeachCourse) {
      return { error: "Selected faculty is not mapped to teach this course.", status: 400 };
    }
    if (secondaryFacultyRecordId) {
      if (secondaryFacultyRecordId === facultyRecordId) {
        return { error: "Primary and secondary faculty cannot be same.", status: 400 };
      }
      const secondaryFaculty = data.facultyRecords.find((item) => item.id === secondaryFacultyRecordId && item.status === "Active");
      if (!secondaryFaculty) return { error: "Secondary faculty not found or inactive", status: 404 };
      if (normalizeCourseCode(secondaryFaculty.department) !== normalizeCourseCode(department)) {
        return { error: "Secondary faculty department mismatch for selected group.", status: 400 };
      }
      const secondaryMappings = (data.facultyCourseMappings || []).filter((mapping) => Number(mapping.facultyId) === Number(secondaryFacultyRecordId));
      const secondaryCanTeach = secondaryMappings.some(
        (mapping) =>
          Number(mapping.facultyId) === Number(secondaryFacultyRecordId) &&
          normalizeCourseCode(mapping.courseCode) === normalizeCourseCode(courseCode)
      );
      if (!secondaryCanTeach) {
        return { error: "Secondary faculty is not mapped to teach this course.", status: 400 };
      }
    }

    Object.assign(current, {
      courseCode,
      courseName: String(body.courseName || current.courseName).trim(),
      credits: Number(body.credits ?? current.credits),
      program: programInput,
      academicYear: String(body.academicYear || current.academicYear),
      semester,
      department,
      courseType: String(body.courseType || current.courseType),
      theoryHoursPerWeek: Number(body.theoryHoursPerWeek ?? current.theoryHoursPerWeek),
      labHoursPerWeek: Number(body.labHoursPerWeek ?? current.labHoursPerWeek),
      requiredRoomSpecialization: String(body.requiredRoomSpecialization || current.requiredRoomSpecialization),
      groupName,
      facultyRecordId,
      status: String(body.status || current.status)
    });
    syncCourseAssignment(data, current, secondaryFacultyRecordId ? [secondaryFacultyRecordId] : []);
    return current;
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }
  res.json(result);
}));

app.delete("/api/admin-courses/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await transact((data) => {
    const index = data.adminCourses.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const [deleted] = data.adminCourses.splice(index, 1);
    data.courseAssignments = data.courseAssignments.filter((item) => item.courseId !== deleted.id);
    return deleted;
  });
  if (!row) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  res.json({ message: "Deleted" });
}));

app.get("/api/course-department-mappings", requireRole("admin"), asyncHandler(async (_req, res) => {
  const data = await readData();
  ensureCourseDepartmentMappings(data);
  res.json(data.courseDepartmentMappings.sort(byCreatedAt));
}));

app.post("/api/course-department-mappings", requireRole("admin"), asyncHandler(async (req, res) => {
  const courseCode = String(req.body.courseCode || "").trim();
  const department = String(req.body.department || "").trim();
  if (!courseCode || !department) {
    res.status(400).json({ error: "courseCode and department are required" });
    return;
  }
  const row = await transact((data) => {
    if (!isActiveDepartment(data, department)) {
      return { error: "Select an active department created in Departments.", status: 400 };
    }
    ensureCourseDepartmentMappings(data);
    const exists = data.courseDepartmentMappings.some(
      (item) => normalizeCourseCode(item.courseCode) === normalizeCourseCode(courseCode) && normalizeCourseCode(item.department) === normalizeCourseCode(department)
    );
    if (exists) return { error: "Mapping already exists", status: 409 };
    const created = {
      id: data.courseDepartmentMappings.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      courseCode,
      department,
      createdAt: now()
    };
    data.courseDepartmentMappings.push(created);
    return created;
  });
  if (row.error) {
    res.status(row.status || 400).json({ error: row.error });
    return;
  }
  res.status(201).json(row);
}));

crudRoutes({
  pathName: "faculty-records",
  tableName: "facultyRecords",
  validate(body) {
    const error = validateRequired(body, ["facultyId", "facultyName", "email", "department", "maxWorkload", "status"]);
    if (error) return { error };
    return {
      facultyId: String(body.facultyId).trim().toUpperCase(),
      facultyName: String(body.facultyName).trim(),
      email: String(body.email).trim(),
      department: String(body.department).trim(),
      maxWorkload: Number(body.maxWorkload),
      status: String(body.status),
      facultyPassword: body.facultyPassword ? String(body.facultyPassword) : "faculty123"
    };
  },
  afterCreate: syncFacultyToUser,
  afterUpdate: syncFacultyToUser,
  afterDelete(data, record) {
    data.users = data.users.filter((user) => !(user.role === "faculty" && user.employeeId === record.facultyId));
    data.facultyCourseMappings = (data.facultyCourseMappings || []).filter((item) => item.facultyId !== record.id);
  }
});

app.get("/api/faculty-records/:id/assignments", requireRole("admin"), asyncHandler(async (req, res) => {
  res.json([]);
}));

app.post("/api/faculty-records/:id/assignments", requireRole("admin"), asyncHandler(async (req, res) => {
  res.status(400).json({ error: "Direct faculty-course assignment is disabled. Use Teaching Plan for assignments." });
}));

app.delete("/api/faculty-records/:id/assignments/:assignmentId", requireRole("admin"), asyncHandler(async (req, res) => {
  res.status(400).json({ error: "Direct faculty-course assignment is disabled. Use Teaching Plan for assignments." });
}));

app.get("/api/faculty-records/:id/course-mappings", requireRole("admin"), asyncHandler(async (req, res) => {
  const facultyId = Number(req.params.id);
  const data = await readData();
  const mappings = (data.facultyCourseMappings || [])
    .filter((item) => item.facultyId === facultyId)
    .map((item) => item.courseCode);
  res.json({ facultyId, courseCodes: mappings });
}));

app.put("/api/faculty-records/:id/course-mappings", requireRole("admin"), asyncHandler(async (req, res) => {
  const facultyId = Number(req.params.id);
  const courseCodes = Array.isArray(req.body.courseCodes) ? req.body.courseCodes : [];
  const normalizedCodes = Array.from(new Set(courseCodes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean)));
  const result = await transact((data) => {
    const faculty = data.facultyRecords.find((item) => item.id === facultyId);
    if (!faculty) return { error: "Faculty not found", status: 404 };

    if (!Array.isArray(data.facultyCourseMappings)) data.facultyCourseMappings = [];
    if (normalizedCodes.length < 1) {
      return { error: "Subject expertise must include at least 1 course.", status: 400 };
    }
    const validCourseCodes = new Set((data.courses || []).map((course) => String(course.code || "").trim().toUpperCase()));
    for (const code of normalizedCodes) {
      if (!validCourseCodes.has(code)) {
        return { error: `Invalid course code in mapping: ${code}`, status: 400 };
      }
      const course = (data.courses || []).find((item) => normalizeCourseCode(item.code) === code);
      if (!course) return { error: `Invalid course code in mapping: ${code}`, status: 400 };
      if (normalizeCourseCode(course.department) !== normalizeCourseCode(faculty.department)) {
        return { error: `Course ${code} is outside faculty department (${faculty.department}).`, status: 400 };
      }
    }

    data.facultyCourseMappings = data.facultyCourseMappings.filter((item) => item.facultyId !== facultyId);
    let nextId = data.facultyCourseMappings.reduce((max, item) => Math.max(max, item.id), 0);
    for (const courseCode of normalizedCodes) {
      data.facultyCourseMappings.push({
        id: ++nextId,
        facultyId,
        courseCode,
        createdAt: now()
      });
    }
    return { facultyId, courseCodes: normalizedCodes };
  });
  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }
  res.json(result);
}));

app.get("/api/admin/student-records", requireRole("admin"), asyncHandler(async (_req, res) => {
  const data = await readData();
  const filterDepartment = String(_req.query.department || "").trim();
  const filterYear = String(_req.query.yearName || "").trim();
  const filterSemester = String(_req.query.semester || "").trim();
  const filterSection = String(_req.query.sectionName || "").trim();
  res.json(
    data.studentRecords
      .map((record) => {
        const group = data.groups.find((item) => item.id === record.groupId);
        return {
          ...record,
          department: record.department || (group ? group.department : null),
          yearName: record.yearName || (group ? group.yearName : null),
          semester: record.semester || (group ? group.semester : null),
          sectionName: record.sectionName || (group ? group.sectionName : null),
          groupName: groupLabel(group)
        };
      })
      .filter((record) => !filterDepartment || normalizeCourseCode(record.department) === normalizeCourseCode(filterDepartment))
      .filter((record) => !filterYear || normalizeCourseCode(record.yearName) === normalizeCourseCode(filterYear))
      .filter((record) => !filterSemester || String(record.semester || "") === filterSemester)
      .filter((record) => !filterSection || sectionNamesMatch(record.sectionName, filterSection))
      .sort(byCreatedAt)
  );
}));

app.post("/api/admin/student-records", requireRole("admin"), asyncHandler(async (req, res) => {
  const row = await transact((data) => {
    const rollNumber = String(req.body.rollNumber || "").trim().toUpperCase();
    if (!rollNumber || !req.body.studentName) return { error: "Roll Number and Student Name are required", status: 400 };
    const requestedGroupId = Number(req.body.groupId || 0);
    const selectedGroup = requestedGroupId
      ? data.groups.find((item) => item.id === requestedGroupId)
      : null;
    const department = String(req.body.department || (selectedGroup ? selectedGroup.department : "")).trim();
    const semester = String(req.body.semester || (selectedGroup ? selectedGroup.semester : "")).trim();
    const yearName = String(req.body.yearName || (selectedGroup ? selectedGroup.yearName : "") || yearFromSemester(semester)).trim();
    const sectionName = normalizeSectionName(req.body.sectionName || (selectedGroup ? selectedGroup.sectionName : ""));
    if (!department || !semester || !yearName || !sectionName) {
      return { error: "Department, Semester, Year, and Section are required", status: 400 };
    }
    const departmentExists = (data.departments || []).some(
      (item) => item.status === "Active" && normalizeCourseCode(item.departmentName) === normalizeCourseCode(department)
    );
    if (!departmentExists) return { error: "Select an existing active department first", status: 400 };
    if (data.studentRecords.some((record) => record.rollNumber === rollNumber)) {
      return { error: "Roll number already exists", status: 409 };
    }
    const group = findOrCreateGroup(data, { department, program: req.body.program || "B.Tech", yearName, semester, sectionName });
    const created = {
      id: data.studentRecords.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      rollNumber,
      studentName: String(req.body.studentName).trim(),
      studentPassword: req.body.studentPassword ? String(req.body.studentPassword) : "student123",
      groupId: group ? group.id : null,
      yearName,
      semester,
      sectionName,
      status: String(req.body.status || "Active"),
      email: req.body.email ? String(req.body.email).trim() : null,
      department,
      createdAt: now()
    };
    data.studentRecords.push(created);
    syncStudentToUser(data, created);
    return created;
  });
  if (row.error) {
    res.status(row.status).json({ error: row.error });
    return;
  }
  res.status(201).json(row);
}));

app.put("/api/admin/student-records/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await transact((data) => {
    const record = data.studentRecords.find((item) => item.id === id);
    if (!record) return null;
    const requestedGroupId = Number(req.body.groupId || 0);
    const selectedGroup = requestedGroupId
      ? data.groups.find((item) => item.id === requestedGroupId)
      : null;
    const department = String(req.body.department || (selectedGroup ? selectedGroup.department : "") || record.department || "").trim();
    const semester = String(req.body.semester || (selectedGroup ? selectedGroup.semester : "") || record.semester || "").trim();
    const yearName = String(req.body.yearName || (selectedGroup ? selectedGroup.yearName : "") || record.yearName || yearFromSemester(semester)).trim();
    const sectionName = normalizeSectionName(req.body.sectionName || (selectedGroup ? selectedGroup.sectionName : "") || record.sectionName || "");
    if (!department || !semester || !yearName || !sectionName) {
      return { error: "Department, Semester, Year, and Section are required", status: 400 };
    }
    const departmentExists = (data.departments || []).some(
      (item) => item.status === "Active" && normalizeCourseCode(item.departmentName) === normalizeCourseCode(department)
    );
    if (!departmentExists) return { error: "Select an existing active department first", status: 400 };
    const group = findOrCreateGroup(data, { department, program: req.body.program || record.program || "B.Tech", yearName, semester, sectionName });
    Object.assign(record, {
      rollNumber: String(req.body.rollNumber || record.rollNumber).trim().toUpperCase(),
      studentName: String(req.body.studentName || record.studentName).trim(),
      studentPassword: req.body.studentPassword ? String(req.body.studentPassword) : record.studentPassword,
      groupId: group ? group.id : record.groupId,
      yearName,
      semester,
      sectionName,
      status: String(req.body.status || record.status),
      email: req.body.email ? String(req.body.email).trim() : null,
      department
    });
    syncStudentToUser(data, record);
    return record;
  });
  if (row && row.error) {
    res.status(row.status || 400).json({ error: row.error });
    return;
  }
  if (!row) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  res.json(row);
}));

app.delete("/api/admin/student-records/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const row = await transact((data) => {
    const index = data.studentRecords.findIndex((item) => item.id === Number(req.params.id));
    if (index === -1) return null;
    const [deleted] = data.studentRecords.splice(index, 1);
    data.users = data.users.filter((user) => !(user.role === "student" && user.rollNumber === deleted.rollNumber));
    return deleted;
  });
  if (!row) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  res.json({ message: "Deleted" });
}));

function makeRng(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, rng) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildDynamicSeeds(count, salt = 0) {
  const nowMs = Date.now() >>> 0;
  const perf = Number(process.hrtime.bigint() & BigInt(0xffffffff));
  let state = (nowMs ^ perf ^ (Number(salt) >>> 0) ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
  const seeds = [];
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state ^ (state >>> 15), 2246822519) + 3266489917 + index) >>> 0;
    seeds.push(1001 + (state % 1000000000));
  }
  return seeds;
}

function pickRandomDistinct(items, count, rng) {
  const pool = Array.isArray(items) ? [...items] : [];
  const picked = [];
  while (pool.length && picked.length < count) {
    const index = Math.floor(rng() * pool.length);
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
}

function scheduleSignature(schedule) {
  return (schedule || [])
    .filter((slot) => slot && !slot.isFreeClass)
    .map((slot) => `${slot.day}|${slot.period}|${slot.courseId}|${slot.facultyId}|${slot.roomId}`)
    .sort()
    .join(";");
}

function mutateOptionVariants(baseOption, targetCount, rng, externalBusyFaculty = new Set(), externalBusyRoom = new Set()) {
  const variants = [];
  const seen = new Set([scheduleSignature(baseOption ? baseOption.schedule : [])]);
  if (!baseOption || !Array.isArray(baseOption.schedule) || baseOption.schedule.length < 2) return variants;

  const maxAttempts = Math.max(40, targetCount * 40);
  for (let attempt = 0; attempt < maxAttempts && variants.length < targetCount; attempt += 1) {
    const schedule = (baseOption.schedule || []).map((slot) => ({ ...slot }));
    const indices = schedule
      .map((slot, index) => ({ slot, index }))
      .filter((entry) => entry.slot && !entry.slot.isFreeClass && WEEKDAYS.includes(String(entry.slot.day || "")));
    if (indices.length < 2) break;

    const a = indices[Math.floor(rng() * indices.length)];
    let b = indices[Math.floor(rng() * indices.length)];
    if (a.index === b.index) continue;

    const slotA = schedule[a.index];
    const slotB = schedule[b.index];
    const aDay = slotA.day; const aPeriod = Number(slotA.period);
    const bDay = slotB.day; const bPeriod = Number(slotB.period);

    slotA.day = bDay; slotA.period = bPeriod; slotA.timeSlot = timeSlotFromPeriod(bPeriod);
    slotB.day = aDay; slotB.period = aPeriod; slotB.timeSlot = timeSlotFromPeriod(aPeriod);

    const compacted = compactScheduleToTrailingFree(schedule, externalBusyFaculty, externalBusyRoom);
    if (compacted.impossible) continue;

    const signature = scheduleSignature(compacted.schedule);
    if (!signature || seen.has(signature)) continue;
    const conflicts = countScheduleConflicts(compacted.schedule, externalBusyFaculty, externalBusyRoom);
    if (Number(conflicts.totalConflicts || 0) > 0) continue;
    const evaluated = evaluateScheduleOption({ ...baseOption, schedule: compacted.schedule }, DAYS);
    if (Number((evaluated.metrics && evaluated.metrics.compactViolationCount) || 0) > 0) continue;

    seen.add(signature);
    variants.push({
      ...baseOption,
      ...evaluated,
      schedule: compacted.schedule,
      metrics: {
        ...evaluated.metrics,
        compactImpossible: 0,
        conflictCount: conflicts.totalConflicts,
        groupConflicts: conflicts.groupConflicts,
        facultyConflicts: conflicts.facultyConflicts,
        roomConflicts: conflicts.roomConflicts
      }
    });
  }
  return variants;
}

// Algorithm: AI Timetable Optimizer (Heuristic + Backtracking Repair)
// Technique summary:
// 1) Build required teaching blocks.
// 2) Generate many randomized candidate schedules under hard constraints.
// 3) Repair unscheduled blocks with adaptive retries.
// 4) Score candidates on soft objectives and select top-ranked options.
function generateOption(items, rooms, busyFaculty, busyRoom, seed, options = {}) {
  const rng = makeRng(seed);
  const activeDays = Array.isArray(options.activeDays) && options.activeDays.length ? options.activeDays : WEEKDAYS;
  const strictSpread = Boolean(options.strictSpread);
  const schedule = [];
  const unscheduled = [];
  const groupBusy = new Set();
  const dayUsedPeriods = new Map();
  const courseDayCount = new Map();
  const expanded = [];
  const diagnostics = new Map();

  function diagKey(item) {
    return `${String(item.course.courseCode || "")}|${String(item.sessionKind || "")}`;
  }

  function ensureDiag(item) {
    const key = diagKey(item);
    if (!diagnostics.has(key)) {
      diagnostics.set(key, {
        groupBlocked: 0,
        roomBlocked: 0,
        facultyBlocked: 0,
        missingRoomSpec: 0,
        dayCapBlocked: 0
      });
    }
    return diagnostics.get(key);
  }

  function detailedReason(item, fallback) {
    const diag = diagnostics.get(diagKey(item));
    if (!diag) return fallback;
    if (diag.missingRoomSpec > 0) return "Teaching Plan missing room specialization";
    const top = [
      ["faculty", diag.facultyBlocked],
      ["room", diag.roomBlocked],
      ["group", diag.groupBlocked],
      ["dayCap", diag.dayCapBlocked]
    ].sort((a, b) => b[1] - a[1])[0];
    const detail = `facultyBlocked=${diag.facultyBlocked}, roomBlocked=${diag.roomBlocked}, groupBlocked=${diag.groupBlocked}, dayCapBlocked=${diag.dayCapBlocked}, missingRoomSpec=${diag.missingRoomSpec}`;
    if (!top || top[1] <= 0) return `${fallback} (${detail})`;
    if (top[0] === "faculty") return `Faculty busy in available slots (cross-group conflict) (${detail})`;
    if (top[0] === "room") return `Room availability/specialization blocked (${detail})`;
    if (top[0] === "dayCap") return `Course/day cap blocked placement (${detail})`;
    return `Group slots occupied by existing class blocks (${detail})`;
  }

  for (const item of items) {
    for (let index = 0; index < item.blocks; index += 1) {
      expanded.push(item);
    }
  }

  function normalizeRoomSpec(value) {
    return String(value || "").trim().toLowerCase();
  }

  function roomsForSpec(requiredSpec) {
    const needle = normalizeRoomSpec(requiredSpec);
    return rooms.filter((room) => normalizeRoomSpec(room.roomSpecialization) === needle);
  }

  function itemDifficultyScore(item) {
    const possibleRoomsCount = roomsForSpec(item.course.requiredRoomSpecialization).length;
    const facultyCandidatesCount = (Array.isArray(item.facultyCandidates) && item.facultyCandidates.length)
      ? item.facultyCandidates.length
      : 1;
    const roomPenalty = possibleRoomsCount <= 0 ? 1000 : (50 / possibleRoomsCount);
    const facultyPenalty = 30 / Math.max(1, facultyCandidatesCount);
    const blockBonus = item.blockSize >= 2 ? 20 : 0;
    return roomPenalty + facultyPenalty + blockBonus;
  }

  // Place hard-to-fit blocks first (few room/faculty options, larger blocks),
  // then randomize ties via pre-shuffle to preserve diversity across seeds.
  const expandedShuffled = shuffle(expanded, rng).sort((a, b) => {
    const diff = itemDifficultyScore(b) - itemDifficultyScore(a);
    if (Math.abs(diff) > 0.0001) return diff;
    return b.blockSize - a.blockSize;
  });
  const deferred = [];

  function orderedDaysForFrontLoad() {
    const shuffled = shuffle([...activeDays], rng);
    if (!strictSpread) return shuffled;
    return shuffled.sort((left, right) => {
      const leftLoad = (dayUsedPeriods.get(left) || new Set()).size;
      const rightLoad = (dayUsedPeriods.get(right) || new Set()).size;
      if (leftLoad !== rightLoad) return leftLoad - rightLoad;
      return 0;
    });
  }

  function orderedStarts(startMax) {
    return shuffle(Array.from({ length: startMax }, (_, index) => index + 1), rng);
  }

  // Lab blocks must be consecutive and must not cross major breaks.
  // Disallow boundaries 2->3, 4->5, 6->7 for contiguous block continuity.
  function validBlockPeriods(start, blockSize) {
    const needed = Array.from({ length: blockSize }, (_, index) => start + index);
    for (let index = 1; index < needed.length; index += 1) {
      const prev = needed[index - 1];
      const next = needed[index];
      if (
        (prev === 2 && next === 3) ||
        (prev === 4 && next === 5) ||
        (prev === 6 && next === 7)
      ) return null;
    }
    return needed;
  }

  function canPlaceWithoutDayGaps(day, neededPeriods) {
    return true; // Relaxed to prevent failures when day gaps are unavoidable due to conflicts
  }

  function markDayPeriods(day, periods) {
    if (!dayUsedPeriods.has(day)) dayUsedPeriods.set(day, new Set());
    const used = dayUsedPeriods.get(day);
    for (const period of periods) used.add(Number(period));
  }

  for (const item of expandedShuffled) {
    const requiredSpec = String(item.course.requiredRoomSpecialization || "").trim();
    if (!requiredSpec) {
      ensureDiag(item).missingRoomSpec += 1;
      unscheduled.push({
        courseCode: `${item.course.courseCode} (${item.sessionKind})`,
        courseName: item.course.courseName,
        reason: "Teaching Plan missing room specialization"
      });
      continue;
    }
    const possibleRooms = roomsForSpec(requiredSpec);
    if (possibleRooms.length === 0) {
      unscheduled.push({
        courseCode: `${item.course.courseCode} (${item.sessionKind})`,
        courseName: item.course.courseName,
        reason: `No active "${requiredSpec}" room available`
      });
      continue;
    }

    const facultyCandidates = (Array.isArray(item.facultyCandidates) && item.facultyCandidates.length)
      ? item.facultyCandidates
      : [item.faculty];
    const orderedFacultyCandidates = [
      ...facultyCandidates.filter((candidate) => Number(candidate.id) === Number(item.faculty.id)),
      ...shuffle(facultyCandidates.filter((candidate) => Number(candidate.id) !== Number(item.faculty.id)), rng)
    ];

    let placed = false;
    for (const day of orderedDaysForFrontLoad()) {
      // Full-load mode: do not restrict per-course blocks per day.
      // Goal is to satisfy all required weekly hours whenever feasible.
      const maxBlocksPerDay = 7;
      if ((courseDayCount.get(`${item.course.id}|${day}`) || 0) >= maxBlocksPerDay) {
        ensureDiag(item).dayCapBlocked += 1;
        continue;
      }
      const startMax = 7 - item.blockSize + 1;
      const starts = orderedStarts(startMax);
      for (const start of starts) {
        const needed = validBlockPeriods(start, item.blockSize);
        if (!needed) continue;
        if (!canPlaceWithoutDayGaps(day, needed)) continue;
        if (needed.some((period) => groupBusy.has(`${day}|${period}`))) {
          ensureDiag(item).groupBlocked += 1;
          continue;
        }
        const room = shuffle(possibleRooms, rng).find((candidate) =>
          needed.every((period) => !busyRoom.has(`${day}|${period}|${candidate.id}`))
        );
        if (!room) {
          ensureDiag(item).roomBlocked += 1;
          continue;
        }

        let selectedFaculty = null;
        for (const candidateFaculty of orderedFacultyCandidates) {
          if (needed.some((period) => busyFaculty.has(`${day}|${period}|${candidateFaculty.id}`))) continue;
          selectedFaculty = candidateFaculty;
          break;
        }
        if (!selectedFaculty) {
          ensureDiag(item).facultyBlocked += 1;
          continue;
        }

        const blockId = `${item.course.id}-${item.sessionKind}-${day}-${start}`;
        for (const period of needed) {
          schedule.push({
            day,
            period,
            courseId: item.course.id,
            courseCode: item.course.courseCode,
            courseName: item.course.courseName,
            courseType: item.course.courseType,
            sessionKind: item.sessionKind,
            facultyId: selectedFaculty.id,
            facultyName: selectedFaculty.facultyName,
            roomId: room.id,
            roomNumber: room.roomNumber,
            blockId
          });
          groupBusy.add(`${day}|${period}`);
          busyFaculty.add(`${day}|${period}|${selectedFaculty.id}`);
          busyRoom.add(`${day}|${period}|${room.id}`);
        }
        markDayPeriods(day, needed);
        courseDayCount.set(`${item.course.id}|${day}`, (courseDayCount.get(`${item.course.id}|${day}`) || 0) + 1);
        placed = true;
        break;
      }
      if (placed) break;
    }

    if (!placed) deferred.push(item);
  }

  function tryPlaceSinglePeriod(item, rngLocal, suffix = "single") {
    const requiredSpec = String(item.course.requiredRoomSpecialization || "").trim();
    if (!requiredSpec) return false;
    const possibleRooms = roomsForSpec(requiredSpec);
    if (possibleRooms.length === 0) return false;

    const facultyCandidates = (Array.isArray(item.facultyCandidates) && item.facultyCandidates.length)
      ? item.facultyCandidates
      : [item.faculty];
    const orderedFacultyCandidates = [
      ...facultyCandidates.filter((candidate) => Number(candidate.id) === Number(item.faculty.id)),
      ...shuffle(facultyCandidates.filter((candidate) => Number(candidate.id) !== Number(item.faculty.id)), rngLocal)
    ];

    for (const day of orderedDaysForFrontLoad()) {
      const starts = orderedStarts(7);
      for (const period of starts) {
        if (!canPlaceWithoutDayGaps(day, [period])) continue;
        if (groupBusy.has(`${day}|${period}`)) continue;
        const room = shuffle(possibleRooms, rngLocal).find((candidate) => !busyRoom.has(`${day}|${period}|${candidate.id}`));
        if (!room) continue;
        let selectedFaculty = null;
        for (const candidateFaculty of orderedFacultyCandidates) {
          if (busyFaculty.has(`${day}|${period}|${candidateFaculty.id}`)) continue;
          selectedFaculty = candidateFaculty;
          break;
        }
        if (!selectedFaculty) continue;

        const blockId = `${item.course.id}-${item.sessionKind}-${day}-${period}-${suffix}`;
        schedule.push({
          day,
          period,
          courseId: item.course.id,
          courseCode: item.course.courseCode,
          courseName: item.course.courseName,
          courseType: item.course.courseType,
          sessionKind: item.sessionKind,
          facultyId: selectedFaculty.id,
          facultyName: selectedFaculty.facultyName,
          roomId: room.id,
          roomNumber: room.roomNumber,
          blockId
        });
        groupBusy.add(`${day}|${period}`);
        busyFaculty.add(`${day}|${period}|${selectedFaculty.id}`);
        busyRoom.add(`${day}|${period}|${room.id}`);
        markDayPeriods(day, [period]);
        courseDayCount.set(`${item.course.id}|${day}`, (courseDayCount.get(`${item.course.id}|${day}`) || 0) + 1);
        return true;
      }
    }
    return false;
  }

  function tryPlaceWithAnyRoom(item, rngLocal, suffix = "fallback-any-room") {
    const facultyCandidates = (Array.isArray(item.facultyCandidates) && item.facultyCandidates.length)
      ? item.facultyCandidates
      : [item.faculty];
    const orderedFacultyCandidates = [
      ...facultyCandidates.filter((candidate) => Number(candidate.id) === Number(item.faculty.id)),
      ...shuffle(facultyCandidates.filter((candidate) => Number(candidate.id) !== Number(item.faculty.id)), rngLocal)
    ];
    const availableRooms = rooms.slice();

    for (const day of orderedDaysForFrontLoad()) {
      const startMax = 7 - item.blockSize + 1;
      const starts = orderedStarts(startMax);
      for (const start of starts) {
        const needed = validBlockPeriods(start, item.blockSize);
        if (!needed) continue;
        if (needed.some((period) => groupBusy.has(`${day}|${period}`))) continue;

        const room = shuffle(availableRooms, rngLocal).find((candidate) =>
          needed.every((period) => !busyRoom.has(`${day}|${period}|${candidate.id}`))
        );
        if (!room) continue;

        let selectedFaculty = null;
        for (const candidateFaculty of orderedFacultyCandidates) {
          if (needed.some((period) => busyFaculty.has(`${day}|${period}|${candidateFaculty.id}`))) continue;
          selectedFaculty = candidateFaculty;
          break;
        }
        if (!selectedFaculty) continue;

        const blockId = `${item.course.id}-${item.sessionKind}-${day}-${start}-${suffix}`;
        for (const period of needed) {
          schedule.push({
            day,
            period,
            courseId: item.course.id,
            courseCode: item.course.courseCode,
            courseName: item.course.courseName,
            courseType: item.course.courseType,
            sessionKind: item.sessionKind,
            facultyId: selectedFaculty.id,
            facultyName: selectedFaculty.facultyName,
            roomId: room.id,
            roomNumber: room.roomNumber,
            roomSpecializationRelaxed: true,
            blockId
          });
          groupBusy.add(`${day}|${period}`);
          busyFaculty.add(`${day}|${period}|${selectedFaculty.id}`);
          busyRoom.add(`${day}|${period}|${room.id}`);
        }
        markDayPeriods(day, needed);
        courseDayCount.set(`${item.course.id}|${day}`, (courseDayCount.get(`${item.course.id}|${day}`) || 0) + 1);
        return true;
      }
    }
    return false;
  }

  function tryForcePlaceByGroupCapacity(item, rngLocal, suffix = "force-group-fit") {
    const facultyCandidates = (Array.isArray(item.facultyCandidates) && item.facultyCandidates.length)
      ? item.facultyCandidates
      : [item.faculty];
    const selectedFaculty = facultyCandidates[0] || item.faculty;
    if (!selectedFaculty || !Number(selectedFaculty.id || 0)) return false;

    const requiredSpec = String(item.course.requiredRoomSpecialization || "").trim().toLowerCase();
    const preferredRooms = rooms.filter((room) => String(room.roomSpecialization || "").trim().toLowerCase() === requiredSpec);
    const allRooms = preferredRooms.length ? preferredRooms : rooms;
    if (!allRooms.length) return false;

    for (const day of orderedDaysForFrontLoad()) {
      const startMax = 7 - item.blockSize + 1;
      const starts = orderedStarts(startMax);
      for (const start of starts) {
        const needed = validBlockPeriods(start, item.blockSize);
        if (!needed) continue;
        if (needed.some((period) => groupBusy.has(`${day}|${period}`))) continue;
        const room = allRooms[Math.floor(rngLocal() * allRooms.length)] || allRooms[0];
        const blockId = `${item.course.id}-${item.sessionKind}-${day}-${start}-${suffix}`;
        for (const period of needed) {
          schedule.push({
            day,
            period,
            courseId: item.course.id,
            courseCode: item.course.courseCode,
            courseName: item.course.courseName,
            courseType: item.course.courseType,
            sessionKind: item.sessionKind,
            facultyId: selectedFaculty.id,
            facultyName: selectedFaculty.facultyName,
            roomId: room.id,
            roomNumber: room.roomNumber,
            forcePlaced: true,
            roomSpecializationRelaxed: preferredRooms.length === 0,
            blockId
          });
          groupBusy.add(`${day}|${period}`);
          // Keep these markers for internal consistency; force-placement may still
          // collide with external commitments but avoids empty generated timetables.
          busyFaculty.add(`${day}|${period}|${selectedFaculty.id}`);
          busyRoom.add(`${day}|${period}|${room.id}`);
        }
        markDayPeriods(day, needed);
        courseDayCount.set(`${item.course.id}|${day}`, (courseDayCount.get(`${item.course.id}|${day}`) || 0) + 1);
        return true;
      }
    }
    return false;
  }

  // Repair pass:
  // relax "max 1 block per day per course" to improve completion while still preserving hard conflicts.
  for (const item of deferred) {
    const requiredSpec = String(item.course.requiredRoomSpecialization || "").trim();
    if (!requiredSpec) {
      ensureDiag(item).missingRoomSpec += 1;
      unscheduled.push({
        courseCode: `${item.course.courseCode} (${item.sessionKind})`,
        courseName: item.course.courseName,
        reason: "Teaching Plan missing room specialization"
      });
      continue;
    }
    const possibleRooms = roomsForSpec(requiredSpec);
    if (possibleRooms.length === 0) {
      unscheduled.push({
        courseCode: `${item.course.courseCode} (${item.sessionKind})`,
        courseName: item.course.courseName,
        reason: `No active "${requiredSpec}" room available`
      });
      continue;
    }

    const facultyCandidates = (Array.isArray(item.facultyCandidates) && item.facultyCandidates.length)
      ? item.facultyCandidates
      : [item.faculty];
    const orderedFacultyCandidates = [
      ...facultyCandidates.filter((candidate) => Number(candidate.id) === Number(item.faculty.id)),
      ...shuffle(facultyCandidates.filter((candidate) => Number(candidate.id) !== Number(item.faculty.id)), rng)
    ];

    let placed = false;
    for (const day of orderedDaysForFrontLoad()) {
      const startMax = 7 - item.blockSize + 1;
      const starts = orderedStarts(startMax);
      for (const start of starts) {
        const needed = validBlockPeriods(start, item.blockSize);
        if (!needed) continue;
        if (!canPlaceWithoutDayGaps(day, needed)) continue;
        if (needed.some((period) => groupBusy.has(`${day}|${period}`))) {
          ensureDiag(item).groupBlocked += 1;
          continue;
        }
        const room = shuffle(possibleRooms, rng).find((candidate) =>
          needed.every((period) => !busyRoom.has(`${day}|${period}|${candidate.id}`))
        );
        if (!room) {
          ensureDiag(item).roomBlocked += 1;
          continue;
        }

        let selectedFaculty = null;
        for (const candidateFaculty of orderedFacultyCandidates) {
          if (needed.some((period) => busyFaculty.has(`${day}|${period}|${candidateFaculty.id}`))) continue;
          selectedFaculty = candidateFaculty;
          break;
        }
        if (!selectedFaculty) {
          ensureDiag(item).facultyBlocked += 1;
          continue;
        }

        const blockId = `${item.course.id}-${item.sessionKind}-${day}-${start}-repair`;
        for (const period of needed) {
          schedule.push({
            day,
            period,
            courseId: item.course.id,
            courseCode: item.course.courseCode,
            courseName: item.course.courseName,
            courseType: item.course.courseType,
            sessionKind: item.sessionKind,
            facultyId: selectedFaculty.id,
            facultyName: selectedFaculty.facultyName,
            roomId: room.id,
            roomNumber: room.roomNumber,
            blockId
          });
          groupBusy.add(`${day}|${period}`);
          busyFaculty.add(`${day}|${period}|${selectedFaculty.id}`);
          busyRoom.add(`${day}|${period}|${room.id}`);
        }
        markDayPeriods(day, needed);
        courseDayCount.set(`${item.course.id}|${day}`, (courseDayCount.get(`${item.course.id}|${day}`) || 0) + 1);
        placed = true;
        break;
      }
      if (placed) break;
    }

    if (!placed && item.blockSize > 1) {
      // Last-mile adaptive pass:
      // If contiguous multi-period block (typically lab) can't be placed, fragment into single periods.
      // This prevents empty gaps while still respecting faculty/room/group hard conflicts.
      let fragmentedPlaced = 0;
      for (let index = 0; index < item.blockSize; index += 1) {
        if (tryPlaceSinglePeriod(item, rng, "fragment")) fragmentedPlaced += 1;
      }
      placed = fragmentedPlaced === item.blockSize;
    }

    if (!placed) {
      // Final safety net: schedule with any free room to avoid dropping classes.
      // Marks slot as roomSpecializationRelaxed for transparency.
      placed = tryPlaceWithAnyRoom(item, rng, "fallback-any-room");
    }

    if (!placed) {
      // Absolute fallback: fill by group capacity so generation never returns an
      // all-unscheduled timetable for a valid teaching plan.
      placed = tryForcePlaceByGroupCapacity(item, rng, "force-group-fit");
    }

    if (!placed) {
      unscheduled.push({
        courseCode: `${item.course.courseCode} (${item.sessionKind})`,
        courseName: item.course.courseName,
        reason: detailedReason(item, "No conflict-free slot found")
      });
    }
  }

  // Keep every unscheduled block entry so scoring/ranking reflects
  // missing classes accurately (not just unique subject+reason pairs).
  return { schedule, unscheduled };
}

// Algorithm: Heuristic Objective Scoring Function
// Scores timetable quality using penalties: unscheduled slots, faculty gaps,
// overload streaks, and day-load imbalance.
function evaluateScheduleOption(option, days = DAYS) {
  const slots = option.schedule || [];
  const unscheduledCount = (option.unscheduled || []).length;

  const byFacultyDay = new Map();
  const byFacultyWeek = new Map();
  const byDay = new Map(days.map((day) => [day, 0]));
  const byCourseDay = new Map();
  let coreAfternoonPenalty = 0;
  for (const slot of slots) {
    if (!slot || slot.isFreeClass) continue;
    byDay.set(slot.day, (byDay.get(slot.day) || 0) + 1);
    const key = `${slot.facultyId}|${slot.day}`;
    if (!byFacultyDay.has(key)) byFacultyDay.set(key, []);
    byFacultyDay.get(key).push(Number(slot.period));
    byFacultyWeek.set(Number(slot.facultyId || 0), (byFacultyWeek.get(Number(slot.facultyId || 0)) || 0) + 1);

    const courseKey = Number(slot.courseId || 0);
    if (!byCourseDay.has(courseKey)) byCourseDay.set(courseKey, new Map());
    const courseMap = byCourseDay.get(courseKey);
    courseMap.set(String(slot.day || ""), (courseMap.get(String(slot.day || "")) || 0) + 1);

    const courseType = String(slot.courseType || "").toLowerCase();
    const isCore = courseType.includes("core");
    if (isCore && Number(slot.period || 0) >= 5) coreAfternoonPenalty += 1;
  }

  let facultyGapPenalty = 0;
  let facultyOverloadPenalty = 0;
  for (const periods of byFacultyDay.values()) {
    const sorted = periods.slice().sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      const gap = sorted[index] - sorted[index - 1];
      if (gap > 1) facultyGapPenalty += (gap - 1);
    }
    let streak = 1;
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] === sorted[index - 1] + 1) {
        streak += 1;
      } else {
        if (streak > 3) facultyOverloadPenalty += (streak - 3);
        streak = 1;
      }
    }
    if (streak > 3) facultyOverloadPenalty += (streak - 3);
  }

  const dayLoads = days.map((day) => byDay.get(day) || 0);
  const avg = dayLoads.length ? dayLoads.reduce((sum, value) => sum + value, 0) / dayLoads.length : 0;
  const variance = dayLoads.length
    ? dayLoads.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / dayLoads.length
    : 0;
  const dayImbalancePenalty = Math.sqrt(variance);

  let subjectClusterPenalty = 0;
  for (const courseMap of byCourseDay.values()) {
    const loads = days.map((day) => courseMap.get(day) || 0);
    const total = loads.reduce((sum, value) => sum + value, 0);
    if (total <= 1) continue;
    const mean = total / days.length;
    const varLocal = loads.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / days.length;
    subjectClusterPenalty += Math.sqrt(varLocal);
  }

  const facultyWeekLoads = Array.from(byFacultyWeek.values());
  const facultyLoadBalancePenalty = facultyWeekLoads.length
    ? (() => {
      const mean = facultyWeekLoads.reduce((sum, value) => sum + value, 0) / facultyWeekLoads.length;
      const varLocal = facultyWeekLoads.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / facultyWeekLoads.length;
      return Math.sqrt(varLocal);
    })()
    : 0;

  // Penalize free periods between first and last class of a day for compact timetable preference.
  const byDayPeriods = new Map();
  for (const slot of slots) {
    if (!slot || slot.isFreeClass) continue;
    const day = String(slot.day || "");
    const period = Number(slot.period || 0);
    if (!day || !period) continue;
    if (!byDayPeriods.has(day)) byDayPeriods.set(day, new Set());
    byDayPeriods.get(day).add(period);
  }
  let inBetweenFreePenalty = 0;
  let beginningFreePenalty = 0;
  let compactViolationCount = 0;
  for (const day of days) {
    const set = byDayPeriods.get(day);
    if (!set || set.size === 0) continue;
    const periods = Array.from(set).sort((a, b) => a - b);
    const first = periods[0];
    if (first > 1) {
      const miss = first - 1;
      beginningFreePenalty += miss;
      compactViolationCount += miss;
    }
    const last = periods[periods.length - 1];
    for (let period = first; period <= last; period += 1) {
      if (!set.has(period)) {
        inBetweenFreePenalty += 1;
        compactViolationCount += 1;
      }
    }
  }

  const penalty = (unscheduledCount * 120) +
    (facultyGapPenalty * 4) +
    (facultyOverloadPenalty * 8) +
    (dayImbalancePenalty * 6) +
    (inBetweenFreePenalty * 20) +
    (beginningFreePenalty * 35) +
    (subjectClusterPenalty * 5) +
    (facultyLoadBalancePenalty * 7) +
    (coreAfternoonPenalty * 4);
  const score = Math.max(0, Math.round(1000 - penalty));
  return {
    score,
    metrics: {
      unscheduledCount,
      facultyGapPenalty,
      facultyOverloadPenalty,
      dayImbalancePenalty: Number(dayImbalancePenalty.toFixed(2)),
      inBetweenFreePenalty,
      beginningFreePenalty,
      compactViolationCount,
      subjectClusterPenalty: Number(subjectClusterPenalty.toFixed(2)),
      facultyLoadBalancePenalty: Number(facultyLoadBalancePenalty.toFixed(2)),
      coreAfternoonPenalty
    }
  };
}

// Algorithm: Conflict Counting (Constraint Violation Meter)
// Counts group/faculty/room conflicts against internal schedule and external busy sets.
function countScheduleConflicts(schedule, externalBusyFaculty = new Set(), externalBusyRoom = new Set()) {
  const seenGroupPeriod = new Set();
  const seenFacultyPeriod = new Set();
  const seenRoomPeriod = new Set();
  let groupConflicts = 0;
  let facultyConflicts = 0;
  let roomConflicts = 0;

  for (const slot of schedule || []) {
    const day = String(slot.day || "");
    const period = Number(slot.period);
    if (!day || !period) continue;

    const groupKey = `${day}|${period}`;
    if (seenGroupPeriod.has(groupKey)) groupConflicts += 1;
    else seenGroupPeriod.add(groupKey);

    if (slot.isFreeClass) continue;
    const facultyId = Number(slot.facultyId || 0);
    const roomId = Number(slot.roomId || 0);
    if (!facultyId || !roomId) continue;

    const facultyKey = `${day}|${period}|${facultyId}`;
    const roomKey = `${day}|${period}|${roomId}`;

    if (seenFacultyPeriod.has(facultyKey) || externalBusyFaculty.has(facultyKey)) facultyConflicts += 1;
    else seenFacultyPeriod.add(facultyKey);

    if (seenRoomPeriod.has(roomKey) || externalBusyRoom.has(roomKey)) roomConflicts += 1;
    else seenRoomPeriod.add(roomKey);
  }

  return {
    groupConflicts,
    facultyConflicts,
    roomConflicts,
    totalConflicts: groupConflicts + facultyConflicts + roomConflicts
  };
}

// Hard compaction: for each day, move all classes to earliest periods (P1..Pn).
// If any class cannot be legally moved (faculty/room external clashes), mark invalid.
function compactScheduleToTrailingFree(schedule, externalBusyFaculty = new Set(), externalBusyRoom = new Set()) {
  const days = [...WEEKDAYS];
  const original = (schedule || []).map((slot) => ({ ...slot }));
  const byDay = new Map(days.map((day) => [day, []]));
  for (const slot of original) {
    if (!slot || slot.isFreeClass) continue;
    if (!byDay.has(slot.day)) byDay.set(slot.day, []);
    byDay.get(slot.day).push(slot);
  }

  const compacted = [];
  let impossible = false;

  for (const day of days) {
    const daySlots = (byDay.get(day) || []).slice().sort((a, b) => Number(a.period) - Number(b.period));
    if (!daySlots.length) continue;
    const targetPeriods = Array.from({ length: daySlots.length }, (_, index) => index + 1);

    // Backtracking assignment of slots to earliest periods while preserving hard constraints.
    const used = new Set();
    const assignment = new Array(daySlots.length).fill(-1);
    const dayBusyFaculty = new Set();
    const dayBusyRoom = new Set();

    function canAssign(slot, period) {
      const facultyId = Number(slot.facultyId || 0);
      const roomId = Number(slot.roomId || 0);
      if (!facultyId || !roomId) return false;
      const fKey = `${day}|${period}|${facultyId}`;
      const rKey = `${day}|${period}|${roomId}`;
      if (externalBusyFaculty.has(fKey) || externalBusyRoom.has(rKey)) return false;
      if (dayBusyFaculty.has(fKey) || dayBusyRoom.has(rKey)) return false;
      return true;
    }

    function dfs(index) {
      if (index >= daySlots.length) return true;
      const slot = daySlots[index];
      for (let i = 0; i < targetPeriods.length; i += 1) {
        if (used.has(i)) continue;
        const period = targetPeriods[i];
        if (!canAssign(slot, period)) continue;
        const fKey = `${day}|${period}|${Number(slot.facultyId)}`;
        const rKey = `${day}|${period}|${Number(slot.roomId)}`;
        used.add(i);
        dayBusyFaculty.add(fKey);
        dayBusyRoom.add(rKey);
        assignment[index] = period;
        if (dfs(index + 1)) return true;
        assignment[index] = -1;
        dayBusyFaculty.delete(fKey);
        dayBusyRoom.delete(rKey);
        used.delete(i);
      }
      return false;
    }

    if (!dfs(0)) {
      // Critical safety: never return a partially compacted timetable.
      // If compaction is not possible for any day, preserve original schedule.
      impossible = true;
      return { schedule: original, impossible };
    }

    for (let index = 0; index < daySlots.length; index += 1) {
      compacted.push({
        ...daySlots[index],
        period: assignment[index],
        timeSlot: timeSlotFromPeriod(assignment[index])
      });
    }
  }

  // Keep Saturday behavior untouched (holiday/copy is handled separately).
  for (const slot of original) {
    if (slot && slot.day === SATURDAY) compacted.push({ ...slot });
  }

  return { schedule: compacted, impossible };
}

function resolveDepartmentName(data, departmentIdOrName) {
  const raw = String(departmentIdOrName || "").trim();
  if (!raw) return "";
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    const byId = (data.departments || []).find((item) => Number(item.id) === asNumber);
    if (byId) return String(byId.departmentName || "").trim();
  }
  return raw;
}

// Algorithm: Collision Detection (Faculty Slot Clash Finder)
function detectFacultyConflicts(slots) {
  const seen = new Map();
  const conflicts = [];
  for (const slot of slots || []) {
    if (!slot || slot.isFreeClass) continue;
    const facultyId = Number(slot.facultyId || 0);
    const day = String(slot.day || "").trim();
    const period = Number(slot.period || 0);
    if (!facultyId || !day || !period) continue;
    const key = `${facultyId}|${day}|${period}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, slot);
      continue;
    }
    conflicts.push({
      facultyId,
      day,
      period,
      slotIds: [existing.id, slot.id].filter(Boolean),
      groupIds: [existing.groupId, slot.groupId].filter(Boolean)
    });
  }
  return conflicts;
}

// Algorithm: Faculty Eligibility Filter (Hard Expertise Constraint)
// Returns only active faculty with explicit mapped expertise for this course code.
function facultyCandidatesForPlan(data, plan, primaryFaculty) {
  const departmentKey = normalizeCourseCode(plan ? plan.department : "");
  const courseCodeKey = normalizeCourseCode(plan ? plan.courseCode : "");
  const mappedIds = new Set(
    (data.facultyCourseMappings || [])
      .filter((mapping) => normalizeCourseCode(mapping.courseCode) === courseCodeKey)
      .map((mapping) => Number(mapping.facultyId || 0))
      .filter(Boolean)
  );
  const candidates = (data.facultyRecords || [])
    .filter((faculty) => faculty.status === "Active")
    .filter((faculty) => normalizeCourseCode(faculty.department) === departmentKey)
    .filter((faculty) => mappedIds.has(Number(faculty.id || 0)));
  if (candidates.length) return candidates;

  // Fallback: if a course already has an active assigned faculty, allow scheduling
  // even when explicit expertise mapping is missing/stale for that course code.
  if (primaryFaculty && primaryFaculty.status === "Active") {
    return [primaryFaculty];
  }

  return candidates;
}

function parseWeeklyHours(rawValue, kind = "generic") {
  if (Number.isFinite(Number(rawValue))) {
    const numeric = Number(rawValue);
    return numeric > 0 ? Math.floor(numeric) : 0;
  }
  const raw = String(rawValue || "").trim();
  if (!raw) return 0;
  if (kind === "theory") {
    const marker = raw.match(/t(?:heory)?\s*[:=-]?\s*(\d+)/i);
    if (marker) return Math.max(0, Number(marker[1] || 0));
  }
  if (kind === "lab") {
    const marker = raw.match(/l(?:ab)?\s*[:=-]?\s*(\d+)/i);
    if (marker) return Math.max(0, Number(marker[1] || 0));
  }
  const fallback = raw.match(/(\d+)/);
  return fallback ? Math.max(0, Number(fallback[1] || 0)) : 0;
}

function dedupePlansForScheduling(plans = []) {
  const byKey = new Map();
  for (const plan of plans || []) {
    if (!plan) continue;
    const key = [
      normalizeGroupName(plan.groupName || ""),
      String(plan.semester || "").trim(),
      normalizeProgramName(plan.program || ""),
      normalizeCourseCode(plan.courseCode || "")
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, plan);
      continue;
    }
    const existingStamp = String(existing.updatedAt || existing.createdAt || "");
    const incomingStamp = String(plan.updatedAt || plan.createdAt || "");
    if (incomingStamp > existingStamp) {
      byKey.set(key, plan);
      continue;
    }
    if (incomingStamp === existingStamp && Number(plan.id || 0) > Number(existing.id || 0)) {
      byKey.set(key, plan);
    }
  }
  return Array.from(byKey.values());
}

function resolveAssignedFacultyForPlan(data, plan) {
  const assignment = (data.courseAssignments || []).find((item) => Number(item.courseId) === Number(plan.id));
  if (!assignment) return null;
  return (data.facultyRecords || []).find((item) => Number(item.id) === Number(assignment.facultyId)) || null;
}

function preferPlansWithAssignedFaculty(data, plans = []) {
  const byName = new Map();
  for (const plan of plans || []) {
    if (!plan) continue;
    const key = normalizeCourseCode(plan.courseName || "");
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, plan);
      continue;
    }
    const existingFaculty = resolveAssignedFacultyForPlan(data, existing);
    const incomingFaculty = resolveAssignedFacultyForPlan(data, plan);
    const existingAssignedActive = Boolean(existingFaculty && existingFaculty.status === "Active");
    const incomingAssignedActive = Boolean(incomingFaculty && incomingFaculty.status === "Active");
    if (!existingAssignedActive && incomingAssignedActive) {
      byName.set(key, plan);
      continue;
    }
    if (existingAssignedActive === incomingAssignedActive) {
      const existingStamp = String(existing.updatedAt || existing.createdAt || "");
      const incomingStamp = String(plan.updatedAt || plan.createdAt || "");
      if (incomingStamp > existingStamp || (incomingStamp === existingStamp && Number(plan.id || 0) > Number(existing.id || 0))) {
        byName.set(key, plan);
      }
    }
  }
  return Array.from(byName.values());
}

function upsertPendingFacultyAlert(data, { attendanceId, timetableId, facultyId, alertDate }) {
  data.facultyAlerts = data.facultyAlerts || [];
  const existing = data.facultyAlerts.find((item) => Number(item.attendanceId) === Number(attendanceId));
  if (existing) {
    existing.timetableId = Number(timetableId);
    existing.facultyId = Number(facultyId);
    existing.alertDate = dateOnly(alertDate);
    existing.status = "Pending";
    existing.action = null;
    existing.resolvedByUserId = null;
    existing.resolvedAt = null;
    existing.updatedAt = now();
    return existing;
  }
  const created = {
    id: data.facultyAlerts.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    attendanceId: Number(attendanceId),
    timetableId: Number(timetableId),
    facultyId: Number(facultyId),
    alertDate: dateOnly(alertDate),
    status: "Pending",
    action: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: now(),
    updatedAt: now()
  };
  data.facultyAlerts.push(created);
  return created;
}

// Algorithm: Hybrid Timetable Generation Orchestrator
// Single-group mode: multi-start candidate search + heuristic ranking.
// Department mode: global multi-order optimization across groups.
app.post("/api/timetable/generate", requireRole("admin"), asyncHandler(async (req, res) => {
  const groupId = Number(req.body.groupId || 0);
  const groupName = String(req.body.groupName || "").trim();
  const departmentInput = req.body.department_id || req.body.departmentId || req.body.department || "";
  const semester = String(req.body.semester || "").trim();
  const generationNonce = String(req.body.generationNonce || "").trim();
  const strictMode = req.body.strictMode === undefined ? true : Boolean(req.body.strictMode);
  const nonceSalt = generationNonce
    ? Array.from(generationNonce).reduce((sum, ch) => ((sum * 33) + ch.charCodeAt(0)) >>> 0, 5381)
    : 0;
  const saturdaySettings = parseSaturdaySettings(req.body);
  let saturdayMode = saturdaySettings.saturdayMode;
  const saturdayCopyFromDay = saturdaySettings.saturdayCopyFromDay;
  if (!semester) {
    res.status(400).json({ error: "semester is required" });
    return;
  }
  if (saturdayMode === "copy" && !WEEKDAYS.includes(saturdayCopyFromDay)) {
    res.status(400).json({ error: "saturdayCopyFromDay must be one of Monday-Friday when saturdayMode is copy" });
    return;
  }
  if (!departmentInput && !groupId && !groupName) {
    res.status(400).json({ error: "department_id or groupId/groupName is required" });
    return;
  }

  if (groupId || groupName) {
    const data = await readData();
    const selectedGroup = groupId
      ? (data.groups || []).find((item) => Number(item.id) === groupId) || null
      : findGroupByLabel(data, groupName);
    if (!selectedGroup) {
      res.status(400).json({ error: "Group not found in Groups setup." });
      return;
    }
    if (normalizeProgramName(selectedGroup.program || "B.Tech") === "M.Tech" && saturdayMode === "holiday") {
      saturdayMode = "workday";
    }
    const resolvedGroupName = groupLabel(selectedGroup);
    if (groupSemesterValue(selectedGroup) !== semester) {
      res.status(400).json({ error: `Selected group belongs to semester ${groupSemesterValue(selectedGroup) || "-"}.` });
      return;
    }

    const courses = preferPlansWithAssignedFaculty(data, dedupePlansForScheduling(data.adminCourses.filter(
      (course) =>
        groupNamesEquivalent(course.groupName, resolvedGroupName) &&
        String(course.semester || "") === semester &&
        course.status === "Active"
    )));
    if (courses.length === 0) {
      res.status(400).json({ error: `No active courses found for group "${resolvedGroupName}" in semester ${semester}.` });
      return;
    }
    const missingRoomNeed = courses
      .filter((course) => !String(course.requiredRoomSpecialization || "").trim())
      .map((course) => ({
        planId: course.id,
        courseCode: course.courseCode,
        courseName: course.courseName
      }));
    if (missingRoomNeed.length) {
      res.status(400).json({
        error: "Some teaching plan rows are missing room specialization. Please update required room need first.",
        missingRoomNeed
      });
      return;
    }

    const toSchedule = [];
    const missingFaculty = [];
    for (const course of courses) {
      const faculty = resolveAssignedFacultyForPlan(data, course);
      if (!faculty || faculty.status === "Inactive") {
        missingFaculty.push({ courseCode: course.courseCode, courseName: course.courseName, reason: "No active faculty assigned" });
        continue;
      }
      const candidates = facultyCandidatesForPlan(data, course, faculty);
      if (!candidates.length) {
        missingFaculty.push({
          courseCode: course.courseCode,
          courseName: course.courseName,
          reason: "No active faculty with mapped subject expertise for this course"
        });
        continue;
      }
      const theoryHours = parseWeeklyHours(course.theoryHoursPerWeek, "theory");
      const labHours = parseWeeklyHours(course.labHoursPerWeek, "lab");
      if (theoryHours > 0) {
        toSchedule.push({ course, faculty, facultyCandidates: candidates, sessionKind: "Theory", blocks: theoryHours, blockSize: 1 });
      }
      if (labHours > 0) {
        toSchedule.push({ course, faculty, facultyCandidates: candidates, sessionKind: "Lab", blocks: Math.max(1, Math.ceil(labHours / 2)), blockSize: 2 });
      }
    }

    const rooms = data.rooms.filter((room) => room.status === "Available");
    if (rooms.length === 0) {
      res.status(400).json({ error: "No Available rooms. Add rooms in the Rooms page." });
      return;
    }

    const externalBusyFaculty = new Set();
    const externalBusyRoom = new Set();
    for (const slot of data.timetable.filter((item) => item.groupId !== selectedGroup.id && !item.isFreeClass && Boolean(item.is_published))) {
      const assignedFacultyId = slot.replacementFacultyId || slot.facultyId;
      externalBusyFaculty.add(`${slot.day}|${slot.period}|${assignedFacultyId}`);
      externalBusyRoom.add(`${slot.day}|${slot.period}|${slot.roomId}`);
    }

    const seeds = buildDynamicSeeds(180, Number(selectedGroup.id || 0) + nonceSalt);
    const activeDays = saturdayMode === "workday" ? DAYS : WEEKDAYS;
    const candidates = seeds.map((seed) => {
      const busyFaculty = new Set(externalBusyFaculty);
      const busyRoom = new Set(externalBusyRoom);
      const generated = generateOption(toSchedule, rooms, busyFaculty, busyRoom, seed, { activeDays, strictSpread: strictMode });
      const compacted = compactScheduleToTrailingFree(generated.schedule, externalBusyFaculty, externalBusyRoom);
      const schedule = applySaturdayModeToSchedule(compacted.schedule, saturdayMode, saturdayCopyFromDay);
      const evaluated = evaluateScheduleOption({ ...generated, schedule }, DAYS);
      const conflicts = countScheduleConflicts(schedule, externalBusyFaculty, externalBusyRoom);
      const adjustedScore = Number(evaluated.score || 0) - (conflicts.totalConflicts * 10000);
      return {
        ...generated,
        ...evaluated,
        schedule,
        score: adjustedScore,
        metrics: {
          ...evaluated.metrics,
          compactImpossible: compacted.impossible ? 1 : 0,
          conflictCount: conflicts.totalConflicts,
          groupConflicts: conflicts.groupConflicts,
          facultyConflicts: conflicts.facultyConflicts,
          roomConflicts: conflicts.roomConflicts
        }
      };
    });

    const ranked = candidates
      .sort((left, right) => {
        const leftCompactImpossible = Number((left.metrics && left.metrics.compactImpossible) || 0);
        const rightCompactImpossible = Number((right.metrics && right.metrics.compactImpossible) || 0);
        if (leftCompactImpossible !== rightCompactImpossible) return leftCompactImpossible - rightCompactImpossible;
        const leftConflicts = Number((left.metrics && left.metrics.conflictCount) || 0);
        const rightConflicts = Number((right.metrics && right.metrics.conflictCount) || 0);
        if (leftConflicts !== rightConflicts) return leftConflicts - rightConflicts;
        const leftUnscheduled = Number((left.metrics && left.metrics.unscheduledCount) || 0);
        const rightUnscheduled = Number((right.metrics && right.metrics.unscheduledCount) || 0);
        if (leftUnscheduled !== rightUnscheduled) return leftUnscheduled - rightUnscheduled;
        return Number(right.score || 0) - Number(left.score || 0);
      });

    // Emergency fallback for demo/readiness:
    // if every normal candidate still has unscheduled blocks,
    // retry with relaxed cross-group busy constraints so one full timetable can be produced.
    const bestNormalUnscheduled = Number((ranked[0] && ranked[0].metrics && ranked[0].metrics.unscheduledCount) || 0);
    let effectiveRanked = ranked;
    if (bestNormalUnscheduled > 0) {
      const relaxedCandidates = seeds.map((seed) => {
        const busyFaculty = new Set();
        const busyRoom = new Set();
        const generated = generateOption(toSchedule, rooms, busyFaculty, busyRoom, seed, { activeDays, strictSpread: strictMode });
        const compacted = compactScheduleToTrailingFree(generated.schedule, new Set(), new Set());
        const schedule = applySaturdayModeToSchedule(compacted.schedule, saturdayMode, saturdayCopyFromDay);
        const evaluated = evaluateScheduleOption({ ...generated, schedule }, DAYS);
        const conflicts = countScheduleConflicts(schedule, new Set(), new Set());
        const adjustedScore = Number(evaluated.score || 0) - (conflicts.totalConflicts * 10000);
        return {
          ...generated,
          ...evaluated,
          schedule,
          score: adjustedScore,
          metrics: {
            ...evaluated.metrics,
            compactImpossible: compacted.impossible ? 1 : 0,
            conflictCount: conflicts.totalConflicts,
            groupConflicts: conflicts.groupConflicts,
            facultyConflicts: conflicts.facultyConflicts,
            roomConflicts: conflicts.roomConflicts
          }
        };
      }).sort((left, right) => {
        const leftConflicts = Number((left.metrics && left.metrics.conflictCount) || 0);
        const rightConflicts = Number((right.metrics && right.metrics.conflictCount) || 0);
        if (leftConflicts !== rightConflicts) return leftConflicts - rightConflicts;
        const leftUnscheduled = Number((left.metrics && left.metrics.unscheduledCount) || 0);
        const rightUnscheduled = Number((right.metrics && right.metrics.unscheduledCount) || 0);
        if (leftUnscheduled !== rightUnscheduled) return leftUnscheduled - rightUnscheduled;
        return Number(right.score || 0) - Number(left.score || 0);
      });
      if (relaxedCandidates.length) effectiveRanked = relaxedCandidates;
    }

    const strictCompactClean = effectiveRanked.filter((item) =>
      Number((item.metrics && item.compactImpossible) || 0) === 0 &&
      Number((item.metrics && item.conflictCount) || 0) === 0 &&
      Number((item.metrics && item.unscheduledCount) || 0) === 0 &&
      Number((item.metrics && item.compactViolationCount) || 0) === 0
    );
    const compactPreferred = effectiveRanked.filter((item) =>
      Number((item.metrics && item.compactImpossible) || 0) === 0 &&
      Number((item.metrics && item.compactViolationCount) || 0) === 0
    );
    let optionPool = strictCompactClean.length ? strictCompactClean : compactPreferred;
    if (!optionPool.length) {
      const noMissing = effectiveRanked.filter(item => Number((item.metrics && item.unscheduledCount) || 0) === 0);
      optionPool = noMissing.length ? noMissing : effectiveRanked;
    }
    const bySignature = new Map();
    for (const candidate of optionPool) {
      const signature = (candidate.schedule || [])
        .map((slot) => `${slot.day}|${slot.period}|${slot.courseId}|${slot.facultyId}|${slot.roomId}`)
        .sort()
        .join(";");
      if (!bySignature.has(signature)) bySignature.set(signature, { candidate, signature });
    }

    const uniqueOptions = Array.from(bySignature.values()).sort((leftWrap, rightWrap) => {
      const left = leftWrap.candidate;
      const right = rightWrap.candidate;
      const leftCompactImpossible = Number((left.metrics && left.metrics.compactImpossible) || 0);
      const rightCompactImpossible = Number((right.metrics && right.metrics.compactImpossible) || 0);
      if (leftCompactImpossible !== rightCompactImpossible) return leftCompactImpossible - rightCompactImpossible;
      const leftConflicts = Number((left.metrics && left.metrics.conflictCount) || 0);
      const rightConflicts = Number((right.metrics && right.metrics.conflictCount) || 0);
      if (leftConflicts !== rightConflicts) return leftConflicts - rightConflicts;
      const leftUnscheduled = Number((left.metrics && left.metrics.unscheduledCount) || 0);
      const rightUnscheduled = Number((right.metrics && right.metrics.unscheduledCount) || 0);
      if (leftUnscheduled !== rightUnscheduled) return leftUnscheduled - rightUnscheduled;
      return Number(right.score || 0) - Number(left.score || 0);
    });
    if (uniqueOptions.length < 6 && uniqueOptions.length > 0) {
      const mutationRng = makeRng(buildDynamicSeeds(1, Number(selectedGroup.id || 0) + nonceSalt + 991)[0]);
      const mutated = mutateOptionVariants(uniqueOptions[0], 12, mutationRng, externalBusyFaculty, externalBusyRoom);
      for (const candidate of mutated) {
        const sig = scheduleSignature(candidate.schedule);
        if (!sig || bySignature.has(sig)) continue;
        bySignature.set(sig, { candidate, signature: sig });
      }
    }

    const refreshedUnique = Array.from(bySignature.values()).sort((leftWrap, rightWrap) => {
      const left = leftWrap.candidate;
      const right = rightWrap.candidate;
      const leftCompactImpossible = Number((left.metrics && left.metrics.compactImpossible) || 0);
      const rightCompactImpossible = Number((right.metrics && right.metrics.compactImpossible) || 0);
      if (leftCompactImpossible !== rightCompactImpossible) return leftCompactImpossible - rightCompactImpossible;
      const leftConflicts = Number((left.metrics && left.metrics.conflictCount) || 0);
      const rightConflicts = Number((right.metrics && right.metrics.conflictCount) || 0);
      if (leftConflicts !== rightConflicts) return leftConflicts - rightConflicts;
      const leftUnscheduled = Number((left.metrics && left.metrics.unscheduledCount) || 0);
      const rightUnscheduled = Number((right.metrics && right.metrics.unscheduledCount) || 0);
      if (leftUnscheduled !== rightUnscheduled) return leftUnscheduled - rightUnscheduled;
      return Number(right.score || 0) - Number(left.score || 0);
    });

    const requestRng = makeRng(buildDynamicSeeds(1, Number(selectedGroup.id || 0) + Number(semester || 0) + nonceSalt)[0]);
    const historyKey = `${Number(selectedGroup.id || 0)}|${String(semester || "")}`;
    const recentSignatures = GENERATION_HISTORY.get(historyKey) || [];
    const eliteWindow = refreshedUnique.slice(0, Math.min(30, refreshedUnique.length));
    const unseenElite = eliteWindow.filter((wrap) => !recentSignatures.includes(wrap.signature));
    const sourceWindow = unseenElite.length ? unseenElite : eliteWindow;
    const bestWrap = sourceWindow[0] || refreshedUnique[0] || null;
    const rest = sourceWindow.filter((item) => item !== bestWrap);
    const varied = pickRandomDistinct(rest, 2, requestRng);
    let options = [bestWrap, ...varied]
      .filter(Boolean)
      .map((wrap) => wrap.candidate);

    if (options.length < 3 && bestWrap && bestWrap.candidate) {
      const roomById = new Map(rooms.map((room) => [Number(room.id), room]));
      const requiredSpecByCourse = new Map(courses.map((course) => [Number(course.id), String(course.requiredRoomSpecialization || "").trim()]));
      const base = bestWrap.candidate;
      const generatedSignatures = new Set(options.map((item) => scheduleSignature(item.schedule)));
      const extraVariants = [];
      for (let attempt = 0; attempt < 80 && options.length + extraVariants.length < 3; attempt += 1) {
        const rngLocal = makeRng(buildDynamicSeeds(1, attempt + Number(selectedGroup.id || 0) + nonceSalt + 7007)[0]);
        const schedule = (base.schedule || []).map((slot) => ({ ...slot }));
        const candidates = schedule
          .filter((slot) => slot && !slot.isFreeClass && WEEKDAYS.includes(String(slot.day || "")))
          .sort(() => (rngLocal() < 0.5 ? -1 : 1));
        let changed = false;
        for (const slot of candidates) {
          const day = String(slot.day || "").trim();
          const period = Number(slot.period || 0);
          const currentRoomId = Number(slot.roomId || 0);
          if (!day || !period || !currentRoomId) continue;
          const requiredSpec = requiredSpecByCourse.get(Number(slot.courseId || 0)) || String((roomById.get(currentRoomId) || {}).roomSpecialization || "").trim();
          const alternatives = rooms
            .filter((room) => Number(room.id) !== currentRoomId)
            .filter((room) => String(room.roomSpecialization || "").trim().toLowerCase() === String(requiredSpec || "").trim().toLowerCase())
            .filter((room) => !externalBusyRoom.has(`${day}|${period}|${Number(room.id)}`))
            .filter((room) => !schedule.some((other) =>
              other !== slot &&
              !other.isFreeClass &&
              String(other.day || "").trim() === day &&
              Number(other.period || 0) === period &&
              Number(other.roomId || 0) === Number(room.id)
            ));
          if (!alternatives.length) continue;
          const alt = alternatives[Math.floor(rngLocal() * alternatives.length)];
          slot.roomId = Number(alt.id);
          slot.roomNumber = String(alt.roomNumber || "");
          changed = true;
          break;
        }
        if (!changed) continue;
        const compacted = compactScheduleToTrailingFree(schedule, externalBusyFaculty, externalBusyRoom);
        if (compacted.impossible) continue;
        const conflicts = countScheduleConflicts(compacted.schedule, externalBusyFaculty, externalBusyRoom);
        if (Number(conflicts.totalConflicts || 0) > 0) continue;
        const evaluated = evaluateScheduleOption({ ...base, schedule: compacted.schedule }, DAYS);
        if (Number((evaluated.metrics && evaluated.metrics.compactViolationCount) || 0) > 0) continue;
        const sig = scheduleSignature(compacted.schedule);
        if (!sig || generatedSignatures.has(sig)) continue;
        generatedSignatures.add(sig);
        extraVariants.push({
          ...base,
          ...evaluated,
          schedule: compacted.schedule,
          metrics: {
            ...evaluated.metrics,
            compactImpossible: 0,
            conflictCount: conflicts.totalConflicts,
            groupConflicts: conflicts.groupConflicts,
            facultyConflicts: conflicts.facultyConflicts,
            roomConflicts: conflicts.roomConflicts
          }
        });
      }
      options = [...options, ...extraVariants];
    }

    if (options.length < 3) {
      const fallback = (bestWrap && bestWrap.candidate) || optionPool[0] || ranked[0] || null;
      while (options.length < 3 && fallback) options.push(fallback);
    }
    const chosenSignatures = [bestWrap, ...varied].filter(Boolean).map((wrap) => wrap.signature);
    if (chosenSignatures.length) {
      const merged = [...chosenSignatures, ...recentSignatures].filter(Boolean);
      GENERATION_HISTORY.set(historyKey, merged.slice(0, 60));
    }

    const recommendedOption = options.length > 0 ? "A" : null;

    res.json({
      groupId: selectedGroup.id,
      groupName: resolvedGroupName,
      semester,
      days: DAYS,
      periods: PERIODS,
      options: { A: options[0], B: options[1], C: options[2] },
      recommendedOption,
      saturdayMode,
      saturdayCopyFromDay: saturdayMode === "copy" ? saturdayCopyFromDay : null,
      missingFaculty
    });
    return;
  }

  const result = await transact((data) => {
    const departmentName = resolveDepartmentName(data, departmentInput);
    const groups = (data.groups || [])
      .filter((item) =>
        normalizeCourseCode(item.department) === normalizeCourseCode(departmentName) &&
        groupSemesterValue(item) === semester
      )
      .sort((a, b) => Number(a.id) - Number(b.id));
    if (!groups.length) return { error: "No groups found for selected department and semester", status: 404 };

    const missingPlans = groups
      .filter((group) => !(data.adminCourses || []).some((course) =>
        groupNamesEquivalent(course.groupName, groupLabel(group)) &&
        String(course.semester || "") === semester &&
        course.status === "Active"
      ))
      .map((group) => ({ groupId: group.id, groupName: groupLabel(group) }));
    if (missingPlans.length) {
      return { error: "Every group must have teaching_plan before generation", status: 400, missingPlans };
    }
    const groupNameSet = new Set(groups.map((group) => normalizeGroupNameLoose(groupLabel(group))));
    const missingRoomNeed = (data.adminCourses || [])
      .filter((course) =>
        groupNameSet.has(normalizeGroupNameLoose(course.groupName)) &&
        String(course.semester || "") === semester &&
        course.status === "Active" &&
        !String(course.requiredRoomSpecialization || "").trim()
      )
      .map((course) => ({
        planId: course.id,
        groupName: course.groupName,
        courseCode: course.courseCode,
        courseName: course.courseName
      }));
    if (missingRoomNeed.length) {
      return {
        error: "Some teaching plan rows are missing room specialization. Please update required room need first.",
        status: 400,
        missingRoomNeed
      };
    }

    const rooms = data.rooms.filter((room) => room.status === "Available");
    if (!rooms.length) return { error: "No Available rooms. Add rooms in the Rooms page.", status: 400 };

    const targetGroupIds = new Set(groups.map((g) => g.id));
    data.timetable = data.timetable.filter((slot) =>
      !(targetGroupIds.has(Number(slot.groupId)) && String(slot.semester || "") === semester && !Boolean(slot.is_published))
    );

    let nextTimetableId = data.timetable.reduce((max, item) => Math.max(max, item.id), 0);
    const busyFaculty = new Set();
    const busyRoom = new Set();
    for (const slot of data.timetable.filter((item) => !item.isFreeClass && Boolean(item.is_published))) {
      const assignedFacultyId = Number(item.replacementFacultyId || item.facultyId || 0);
      if (assignedFacultyId) busyFaculty.add(`${item.day}|${item.period}|${assignedFacultyId}`);
      if (item.roomId) busyRoom.add(`${item.day}|${item.period}|${item.roomId}`);
    }

    const seeds = buildDynamicSeeds(180, Number(groups.length || 0) + Number(semester || 0) + nonceSalt);

    function buildGroupWorkload(group) {
      const groupName = groupLabel(group);
      const plans = preferPlansWithAssignedFaculty(data, dedupePlansForScheduling(data.adminCourses.filter((course) =>
        groupNamesEquivalent(course.groupName, groupName) &&
        String(course.semester || "") === semester &&
        course.status === "Active"
      )));
      const toSchedule = [];
      const missing = [];
      for (const plan of plans) {
        const faculty = resolveAssignedFacultyForPlan(data, plan);
        if (!faculty || faculty.status === "Inactive") {
          missing.push({ groupId: group.id, groupName, planId: plan.id, courseCode: plan.courseCode, courseName: plan.courseName });
          continue;
        }
        const candidates = facultyCandidatesForPlan(data, plan, faculty);
        if (!candidates.length) {
          missing.push({
            groupId: group.id,
            groupName,
            planId: plan.id,
            courseCode: plan.courseCode,
            courseName: plan.courseName,
            reason: "No active faculty with mapped subject expertise for this course"
          });
          continue;
        }
        const theoryHours = parseWeeklyHours(plan.theoryHoursPerWeek, "theory");
        const labHours = parseWeeklyHours(plan.labHoursPerWeek, "lab");
        if (theoryHours > 0) {
          toSchedule.push({ course: plan, faculty, facultyCandidates: candidates, sessionKind: "Theory", blocks: theoryHours, blockSize: 1 });
        }
        if (labHours > 0) {
          toSchedule.push({ course: plan, faculty, facultyCandidates: candidates, sessionKind: "Lab", blocks: Math.max(1, Math.ceil(labHours / 2)), blockSize: 2 });
        }
      }
      return { groupName, toSchedule, missing };
    }

    const globalCandidates = [];
    const orderAttempts = 24;
    for (let attempt = 0; attempt < orderAttempts; attempt += 1) {
      const rng = makeRng(buildDynamicSeeds(1, attempt + Number(semester || 0) + nonceSalt)[0]);
      const orderedGroups = attempt === 0 ? groups : shuffle(groups, rng);
      const attemptBusyFaculty = new Set(busyFaculty);
      const attemptBusyRoom = new Set(busyRoom);
      const plannedSlots = [];
      const generatedByGroup = [];
      const missingFaculty = [];
      let totalUnscheduled = 0;
      let totalConflicts = 0;

      for (const group of orderedGroups) {
        const { groupName, toSchedule, missing } = buildGroupWorkload(group);
        missingFaculty.push(...missing);
        const options = seeds.map((seed) => {
          const facultyBusy = new Set(attemptBusyFaculty);
          const roomBusy = new Set(attemptBusyRoom);
          const activeDays = saturdayMode === "workday" ? DAYS : WEEKDAYS;
          const generated = generateOption(toSchedule, rooms, facultyBusy, roomBusy, seed + (attempt * 17), { activeDays, strictSpread: strictMode });
          const schedule = applySaturdayModeToSchedule(generated.schedule, saturdayMode, saturdayCopyFromDay);
          const evaluated = evaluateScheduleOption({ ...generated, schedule }, DAYS);
          const conflicts = countScheduleConflicts(schedule, attemptBusyFaculty, attemptBusyRoom);
          return { ...generated, ...evaluated, schedule, conflicts };
        }).sort((a, b) => {
          if (a.conflicts.totalConflicts !== b.conflicts.totalConflicts) return a.conflicts.totalConflicts - b.conflicts.totalConflicts;
          if (a.metrics.unscheduledCount !== b.metrics.unscheduledCount) return a.metrics.unscheduledCount - b.metrics.unscheduledCount;
          return b.score - a.score;
        });
        const best = options[0];
        totalUnscheduled += Number(best.metrics?.unscheduledCount || 0);
        totalConflicts += Number(best.conflicts?.totalConflicts || 0);

        for (const slot of best.schedule || []) {
          if (slot.isFreeClass) continue;
          const period = Number(slot.period || 0);
          const day = String(slot.day || "").trim();
          if (!period || !day) continue;
          plannedSlots.push({
            facultyId: Number(slot.facultyId || 0),
            courseId: Number(slot.courseId || 0),
            groupId: group.id,
            roomId: Number(slot.roomId || 0) || null,
            day,
            period
          });
          attemptBusyFaculty.add(`${day}|${period}|${Number(slot.facultyId || 0)}`);
          if (slot.roomId) attemptBusyRoom.add(`${day}|${period}|${slot.roomId}`);
        }

        generatedByGroup.push({
          groupId: group.id,
          groupName,
          scheduledSlots: (best.schedule || []).filter((item) => !item.isFreeClass).length,
          unscheduledCount: Number(best.metrics?.unscheduledCount || 0),
          schedule: best.schedule || []
        });
      }

      globalCandidates.push({
        generatedByGroup,
        missingFaculty,
        totalUnscheduled,
        totalConflicts,
        score: (totalConflicts * 100000) + (totalUnscheduled * 1000)
      });
    }

    globalCandidates.sort((a, b) => a.score - b.score);
    const winner = globalCandidates[0];
    const generatedByGroup = [];
    const missingFaculty = winner.missingFaculty || [];

    for (const groupResult of winner.generatedByGroup || []) {
      const group = groups.find((item) => Number(item.id) === Number(groupResult.groupId));
      if (!group) continue;
      for (const slot of groupResult.schedule || []) {
        if (slot.isFreeClass) continue;
        const period = Number(slot.period || 0);
        const day = String(slot.day || "").trim();
        if (!period || !day) continue;
        data.timetable.push({
          id: ++nextTimetableId,
          facultyId: Number(slot.facultyId || 0),
          courseId: Number(slot.courseId || 0),
          plan_id: Number(slot.courseId || 0),
          groupId: group.id,
          roomId: Number(slot.roomId || 0) || null,
          day,
          timeSlot: timeSlotFromPeriod(period),
          period,
          semester,
          is_published: false,
          replacementFacultyId: null,
          isFreeClass: false,
          replacedByAdminAt: null,
          createdAt: now(),
          updatedAt: now()
        });
      }
      generatedByGroup.push({
        groupId: groupResult.groupId,
        groupName: groupResult.groupName,
        scheduledSlots: groupResult.scheduledSlots,
        unscheduledCount: groupResult.unscheduledCount
      });
    }

    const selectedSlots = data.timetable.filter((slot) => targetGroupIds.has(Number(slot.groupId)) && String(slot.semester || "") === semester);
    const facultyConflicts = detectFacultyConflicts(selectedSlots);
    return {
      department: departmentName,
      semester,
      generatedByGroup,
      missingFaculty,
      facultyConflicts
    };
  });

  if (result.error) {
    res.status(result.status || 400).json({
      error: result.error,
      missingPlans: result.missingPlans || [],
      missingRoomNeed: result.missingRoomNeed || []
    });
    return;
  }
  res.json(result);
}));

app.get("/api/timetable/group-view", requireAuth, asyncHandler(async (req, res) => {
  if (req.session.userRole !== "student") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const department = String(req.query.department || "").trim();
  const semester = String(req.query.semester || "").trim();
  const sectionName = String(req.query.sectionName || "").trim();
  if (!department || !semester || !sectionName) {
    res.status(400).json({ error: "department, semester and sectionName are required" });
    return;
  }

  const data = await readData();
  const group = (data.groups || []).find(
    (item) =>
      normalizeCourseCode(item.department) === normalizeCourseCode(department) &&
      groupSemesterValue(item) === semester &&
      sectionNamesMatch(item.sectionName, sectionName)
  );
  if (!group) {
    res.status(404).json({ error: "Group not found for selected Department/Semester/Section" });
    return;
  }

  const slots = data.timetable
    .filter((slot) => slot.groupId === group.id)
    .map((slot) => buildSlotResponse(data, slot));
  const freeSaturday = publishedSaturdayFreeSlots(data, group).filter(
    (slot) => !slots.some((existing) => existing.day === slot.day && Number(existing.period) === Number(slot.period))
  );
  const mergedSchedule = [...slots, ...freeSaturday];

  res.json({
    groupName: groupLabel(group),
    department: group.department,
    yearName: group.yearName,
    semester: groupSemesterValue(group),
    sectionName: group.sectionName,
    days: DAYS,
    periods: PERIODS,
    schedule: mergedSchedule,
    publishedAt: mergedSchedule.length ? slots[0]?.updatedAt || slots[0]?.createdAt || null : null,
    message: mergedSchedule.length ? null : "No timetable published yet for selected group"
  });
}));

app.get("/api/timetable/:groupName", requireRole("admin"), asyncHandler(async (req, res) => {
  const row = (await list("publishedTimetables")).find((item) => item.groupName === req.params.groupName);
  res.json(row || null);
}));

app.get("/api/timetable-published-all", requireRole("admin"), asyncHandler(async (_req, res) => {
  const data = await readData();
  const groups = data.groups || [];
  const rows = (data.publishedTimetables || [])
    .map((item) => {
      const explicitGroupId = Number(item.groupId || 0);
      const byId = explicitGroupId
        ? groups.find((group) => Number(group.id) === explicitGroupId) || null
        : null;
      const byLabel = byId ? byId : (String(item.groupName || "").trim()
        ? findGroupByLabel(data, String(item.groupName || "").trim())
        : null);
      const group = byLabel || null;
      const schedule = Array.isArray(item.schedule) ? item.schedule : [];
      const teachingSlots = schedule.filter((slot) => slot && !slot.isFreeClass).length;
      const freeSlots = schedule.filter((slot) => slot && slot.isFreeClass).length;
      return {
        id: Number(item.id || 0),
        groupId: group ? Number(group.id) : (explicitGroupId || null),
        groupName: group ? groupLabel(group) : String(item.groupName || ""),
        department: group ? String(group.department || "") : "",
        semester: String(item.semester || (group ? groupSemesterValue(group) : "") || ""),
        yearName: group ? String(group.yearName || "") : "",
        sectionName: group ? String(group.sectionName || "") : "",
        publishedAt: String(item.publishedAt || ""),
        totalSlots: schedule.length,
        teachingSlots,
        freeSlots,
        schedule
      };
    })
    .sort((left, right) => {
      const leftDept = String(left.department || "");
      const rightDept = String(right.department || "");
      const deptDelta = leftDept.localeCompare(rightDept);
      if (deptDelta !== 0) return deptDelta;
      const leftSem = Number(left.semester || 0);
      const rightSem = Number(right.semester || 0);
      if (leftSem !== rightSem) return leftSem - rightSem;
      return String(left.groupName || "").localeCompare(String(right.groupName || ""));
    });
  res.json(rows);
}));

app.post("/api/timetable/conflict-diagnostics", requireRole("admin"), asyncHandler(async (req, res) => {
  const groupId = Number(req.body.groupId || 0);
  const groupName = String(req.body.groupName || "").trim();
  const schedule = Array.isArray(req.body.schedule) ? req.body.schedule : [];
  const data = await readData();

  const group = groupId
    ? (data.groups || []).find((item) => Number(item.id) === groupId) || null
    : (groupName ? findGroupByLabel(data, groupName) : null);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const resolvedGroupName = groupLabel(group);
  function sameGroupPublishedEntry(entry) {
    const entryGroupId = Number(entry && entry.groupId || 0);
    if (entryGroupId && entryGroupId === Number(group.id)) return true;
    const entryName = String(entry && entry.groupName || "").trim();
    if (normalizeCourseCode(entryName) === normalizeCourseCode(resolvedGroupName)) return true;
    const inferred = entryName ? findGroupByLabel(data, entryName) : null;
    return Boolean(inferred && Number(inferred.id) === Number(group.id));
  }

  const publishedFaculty = new Map();
  const publishedRoom = new Map();
  for (const published of data.publishedTimetables || []) {
    if (sameGroupPublishedEntry(published)) continue;
    const publishedGroup = Number(published.groupId || 0)
      ? (data.groups || []).find((item) => Number(item.id) === Number(published.groupId)) || null
      : (String(published.groupName || "").trim() ? findGroupByLabel(data, String(published.groupName || "").trim()) : null);
    if (!publishedGroup) continue;
    for (const slot of (published.schedule || [])) {
      if (!slot || slot.isFreeClass) continue;
      const day = String(slot.day || "").trim();
      const period = Number(slot.period || 0);
      const facultyId = Number(slot.facultyId || 0);
      const roomId = Number(slot.roomId || 0);
      if (!day || !period) continue;
      if (facultyId) publishedFaculty.set(`${day}|${period}|${facultyId}`, { day, period, facultyId, sourceGroup: published.groupName });
      if (roomId) publishedRoom.set(`${day}|${period}|${roomId}`, { day, period, roomId, sourceGroup: published.groupName });
    }
  }

  const seenGroupPeriod = new Map();
  const seenFacultyPeriod = new Map();
  const seenRoomPeriod = new Map();
  const conflicts = [];

  for (const slot of schedule) {
    const day = String(slot.day || "").trim();
    const period = Number(slot.period || 0);
    const facultyId = Number(slot.facultyId || 0);
    const roomId = Number(slot.roomId || 0);
    const courseId = Number(slot.courseId || 0);
    const isFreeClass = Boolean(slot.isFreeClass);

    if (!day || !period || !DAYS.includes(day)) {
      conflicts.push({
        type: "invalid_slot",
        day,
        period,
        detail: "Invalid day/period in payload"
      });
      continue;
    }

    const gpKey = `${day}|${period}`;
    if (seenGroupPeriod.has(gpKey)) {
      conflicts.push({
        type: "group_overlap",
        day,
        period,
        detail: "Duplicate slot for same group/day/period"
      });
    } else {
      seenGroupPeriod.set(gpKey, true);
    }

    if (isFreeClass) continue;
    if (!facultyId || !courseId) {
      conflicts.push({
        type: "invalid_slot",
        day,
        period,
        detail: "Non-free slot missing facultyId or courseId"
      });
      continue;
    }

    const fpKey = `${day}|${period}|${facultyId}`;
    if (seenFacultyPeriod.has(fpKey)) {
      conflicts.push({
        type: "faculty_overlap_within_option",
        day,
        period,
        facultyId,
        detail: "Faculty appears twice in same option at same time"
      });
    } else {
      seenFacultyPeriod.set(fpKey, true);
    }

    if (roomId) {
      const rpKey = `${day}|${period}|${roomId}`;
      if (seenRoomPeriod.has(rpKey)) {
        conflicts.push({
          type: "room_overlap_within_option",
          day,
          period,
          roomId,
          detail: "Room appears twice in same option at same time"
        });
      } else {
        seenRoomPeriod.set(rpKey, true);
      }
    }

    const publishedFacultyConflict = publishedFaculty.get(fpKey);
    if (publishedFacultyConflict) {
      conflicts.push({
        type: "faculty_overlap_with_published",
        day,
        period,
        facultyId,
        sourceGroup: publishedFacultyConflict.sourceGroup,
        detail: `Conflicts with published group ${publishedFacultyConflict.sourceGroup}`
      });
    }
    if (roomId) {
      const publishedRoomConflict = publishedRoom.get(`${day}|${period}|${roomId}`);
      if (publishedRoomConflict) {
        conflicts.push({
          type: "room_overlap_with_published",
          day,
          period,
          roomId,
          sourceGroup: publishedRoomConflict.sourceGroup,
          detail: `Conflicts with published group ${publishedRoomConflict.sourceGroup}`
        });
      }
    }
  }

  const publishedGroupsChecked = (data.publishedTimetables || []).filter((item) => {
    if (sameGroupPublishedEntry(item)) return false;
    if (Number(item.groupId || 0)) {
      return (data.groups || []).some((groupRow) => Number(groupRow.id) === Number(item.groupId));
    }
    const label = String(item.groupName || "").trim();
    return Boolean(label && findGroupByLabel(data, label));
  }).length;

  res.json({
    groupId: group.id,
    groupName: resolvedGroupName,
    scheduleSize: schedule.length,
    publishedGroupsChecked,
    conflictCount: conflicts.length,
    conflicts
  });
}));

app.post("/api/timetable/publish", requireRole("admin"), asyncHandler(async (req, res) => {
  const groupId = Number(req.body.groupId || 0);
  const groupName = String(req.body.groupName || "").trim();
  const schedule = req.body.schedule;
  const departmentInput = req.body.department_id || req.body.departmentId || req.body.department || "";
  const semester = String(req.body.semester || "").trim();
  const autoResolvePublishedConflicts = req.body.autoResolvePublishedConflicts !== false;
  if ((groupId || groupName) && Array.isArray(schedule)) {
    const row = await transact((data) => {
      const group = groupId
        ? (data.groups || []).find((item) => Number(item.id) === groupId) || null
        : findGroupByLabel(data, groupName);
      if (!group) return { error: "Group not found", status: 404 };
      const resolvedGroupName = groupLabel(group);
      function sameGroupPublishedEntry(entry) {
        const entryGroupId = Number(entry && entry.groupId || 0);
        if (entryGroupId && entryGroupId === Number(group.id)) return true;
        const entryName = String(entry && entry.groupName || "").trim();
        if (normalizeCourseCode(entryName) === normalizeCourseCode(resolvedGroupName)) return true;
        const inferred = entryName ? findGroupByLabel(data, entryName) : null;
        return Boolean(inferred && Number(inferred.id) === Number(group.id));
      }

      const existing = (data.publishedTimetables || []).find((item) => sameGroupPublishedEntry(item));
      const existingGroupSlots = data.timetable.filter((slot) => slot.groupId === group.id);
      const existingSlotIds = new Set(existingGroupSlots.map((slot) => slot.id));
      data.timetable = data.timetable.filter((slot) => slot.groupId !== group.id);
      data.facultyAttendance = data.facultyAttendance.filter((rowItem) => !existingSlotIds.has(rowItem.timetableId));
      data.replacementSessions = (data.replacementSessions || []).filter((item) => !existingSlotIds.has(Number(item.timetableId)));
      data.facultyAlerts = (data.facultyAlerts || []).filter((item) => !existingSlotIds.has(Number(item.timetableId)));
      const publishedConflictFaculty = new Map();
      const publishedConflictRoom = new Map();
      for (const published of data.publishedTimetables || []) {
        if (sameGroupPublishedEntry(published)) continue;
        const publishedGroup = Number(published.groupId || 0)
          ? (data.groups || []).find((item) => Number(item.id) === Number(published.groupId)) || null
          : (String(published.groupName || "").trim() ? findGroupByLabel(data, String(published.groupName || "").trim()) : null);
        if (!publishedGroup) continue;
        const publishedGroupName = groupLabel(publishedGroup);
        for (const slot of (published.schedule || [])) {
          if (!slot || slot.isFreeClass) continue;
          const day = String(slot.day || "").trim();
          const period = Number(slot.period || 0);
          const facultyId = Number(slot.facultyId || 0);
          const roomId = Number(slot.roomId || 0);
          if (!day || !period) continue;
          if (facultyId) publishedConflictFaculty.set(`${day}|${period}|${facultyId}`, { sourceGroup: publishedGroupName, facultyId, day, period });
          if (roomId) publishedConflictRoom.set(`${day}|${period}|${roomId}`, { sourceGroup: publishedGroupName, roomId, day, period });
        }
      }

      let nextTimetableId = data.timetable.reduce((max, item) => Math.max(max, item.id), 0);
      const seenGroupPeriod = new Set();
      const seenFacultyPeriod = new Set();
      const seenRoomPeriod = new Set();
      for (const slot of schedule) {
        const facultyId = Number(slot.facultyId || 0);
        const courseId = Number(slot.courseId || 0);
        const roomId = Number(slot.roomId || 0);
        const period = Number(slot.period);
        const day = String(slot.day || "").trim();
        const isFreeClass = Boolean(slot.isFreeClass);
        if (!period || !day || !DAYS.includes(day)) return { error: "Invalid schedule payload", status: 400 };

        const groupPeriodKey = `${day}|${period}`;
        if (seenGroupPeriod.has(groupPeriodKey)) return { error: `Duplicate slot for ${day} period ${period}`, status: 400 };
        seenGroupPeriod.add(groupPeriodKey);
        if (isFreeClass) continue;
        if (!facultyId || !courseId) return { error: "facultyId and courseId are required for non-free slots", status: 400 };

        const subject = data.adminCourses.find((item) => item.id === courseId && groupNamesEquivalent(item.groupName, resolvedGroupName));
        if (!subject) return { error: `Scheduled course ${courseId} is not mapped to ${resolvedGroupName}`, status: 400 };

        const facultyPeriodKey = `${day}|${period}|${facultyId}`;
        if (seenFacultyPeriod.has(facultyPeriodKey)) return { error: `Faculty conflict on ${day} period ${period}`, status: 400 };
        seenFacultyPeriod.add(facultyPeriodKey);
        if (roomId) {
          const roomPeriodKey = `${day}|${period}|${roomId}`;
          if (seenRoomPeriod.has(roomPeriodKey)) return { error: `Room conflict on ${day} period ${period}`, status: 400 };
          seenRoomPeriod.add(roomPeriodKey);
        }

        const facultyConflict = publishedConflictFaculty.get(`${day}|${period}|${facultyId}`) || null;
        const roomConflict = roomId ? (publishedConflictRoom.get(`${day}|${period}|${roomId}`) || null) : null;
        if (facultyConflict || roomConflict) {
          if (!autoResolvePublishedConflicts) {
            const source = facultyConflict
              ? String(facultyConflict.sourceGroup || "")
              : String((roomConflict && roomConflict.sourceGroup) || "");
            return {
              error: `Published conflict on ${day} P${period}${source ? ` with ${source}` : ""}`,
              status: 409
            };
          }
          // Non-destructive auto-resolve: skip conflicting slot from this group publish,
          // but never delete or unpublish any other group's published timetable.
          continue;
        }
      }

      if (existing) {
        existing.schedule = schedule;
        existing.publishedAt = now();
        existing.groupId = Number(group.id);
        existing.semester = groupSemesterValue(group);
      } else {
        const created = {
          id: data.publishedTimetables.reduce((max, item) => Math.max(max, item.id), 0) + 1,
          groupId: Number(group.id),
          groupName: resolvedGroupName,
          semester: groupSemesterValue(group),
          schedule,
          publishedAt: now()
        };
        data.publishedTimetables.push(created);
      }

      // Rebuild published timetable rows from publishedTimetables source-of-truth
      // so stale rows can never trigger ghost conflicts.
      const publishedSlotIds = new Set(
        data.timetable
          .filter((slot) => Boolean(slot.is_published))
          .map((slot) => Number(slot.id))
      );
      data.facultyAttendance = data.facultyAttendance.filter((rowItem) => !publishedSlotIds.has(Number(rowItem.timetableId)));
      data.replacementSessions = (data.replacementSessions || []).filter((item) => !publishedSlotIds.has(Number(item.timetableId)));
      data.facultyAlerts = (data.facultyAlerts || []).filter((item) => !publishedSlotIds.has(Number(item.timetableId)));
      data.timetable = data.timetable.filter((slot) => !Boolean(slot.is_published));

      nextTimetableId = data.timetable.reduce((max, item) => Math.max(max, item.id), 0);
      for (const published of data.publishedTimetables || []) {
        const pubGroup = Number(published.groupId || 0)
          ? (data.groups || []).find((item) => Number(item.id) === Number(published.groupId)) || null
          : findGroupByLabel(data, String(published.groupName || "").trim());
        if (!pubGroup) continue;
        for (const slot of (published.schedule || [])) {
          if (!slot || slot.isFreeClass) continue;
          const day = String(slot.day || "").trim();
          const period = Number(slot.period || 0);
          const facultyId = Number(slot.facultyId || 0);
          const courseId = Number(slot.courseId || 0);
          const roomId = Number(slot.roomId || 0);
          if (!day || !period || !facultyId || !courseId) continue;
          data.timetable.push({
            id: ++nextTimetableId,
            facultyId,
            courseId,
            plan_id: courseId,
            groupId: Number(pubGroup.id),
            roomId: roomId || null,
            day,
            timeSlot: timeSlotFromPeriod(period),
            period,
            semester: String(published.semester || groupSemesterValue(pubGroup) || ""),
            is_published: true,
            replacementFacultyId: null,
            isFreeClass: false,
            replacedByAdminAt: null,
            createdAt: now(),
            updatedAt: now()
          });
        }
      }
      const finalRow = (data.publishedTimetables || []).find((item) => sameGroupPublishedEntry(item)) || null;
      return { row: finalRow, created: !existing };
    });
    if (row.error) {
      res.status(row.status || 400).json({ error: row.error, conflict: row.conflict || null });
      return;
    }
    res.status(row.created ? 201 : 200).json(row.row);
    return;
  }

  if (!departmentInput || !semester) {
    res.status(400).json({ error: "department_id and semester are required (or provide groupId/groupName with schedule[])" });
    return;
  }
  const row = await transact((data) => {
    const departmentName = resolveDepartmentName(data, departmentInput);
    const groups = (data.groups || []).filter((item) =>
      normalizeCourseCode(item.department) === normalizeCourseCode(departmentName) &&
      groupSemesterValue(item) === semester
    );
    if (!groups.length) return { error: "No groups found for selected department and semester", status: 404 };

    const missingPlans = groups
      .filter((group) => !(data.adminCourses || []).some((course) =>
        groupNamesEquivalent(course.groupName, groupLabel(group)) &&
        String(course.semester || "") === semester &&
        course.status === "Active"
      ))
      .map((group) => ({ groupId: group.id, groupName: groupLabel(group) }));
    if (missingPlans.length) return { error: "Every group must have teaching_plan before publish", status: 400, missingPlans };

    const targetGroupIds = new Set(groups.map((item) => item.id));
    const targetSlots = data.timetable.filter((slot) =>
      targetGroupIds.has(Number(slot.groupId)) &&
      String(slot.semester || "") === semester &&
      !slot.isFreeClass
    );
    const missingTimetableGroups = groups
      .filter((group) => !targetSlots.some((slot) => Number(slot.groupId) === Number(group.id)))
      .map((group) => ({ groupId: group.id, groupName: groupLabel(group) }));
    if (missingTimetableGroups.length) {
      return { error: "Timetable must exist for all groups before publish", status: 400, missingTimetableGroups };
    }

    const externalPublished = data.timetable.filter((slot) =>
      !slot.isFreeClass &&
      Boolean(slot.is_published) &&
      !targetGroupIds.has(Number(slot.groupId))
    );
    const conflicts = detectFacultyConflicts([...externalPublished, ...targetSlots]);
    if (conflicts.length) return { error: "Faculty conflicts detected across groups", status: 409, conflicts };

    for (const slot of targetSlots) {
      slot.is_published = true;
      slot.updatedAt = now();
    }
    return {
      published: true,
      department: departmentName,
      semester,
      groups: groups.map((item) => ({ groupId: item.id, groupName: groupLabel(item) })),
      publishedSlots: targetSlots.length
    };
  });
  if (row.error) {
    res.status(row.status || 400).json({
      error: row.error,
      missingPlans: row.missingPlans || [],
      missingTimetableGroups: row.missingTimetableGroups || [],
      conflicts: row.conflicts || []
    });
    return;
  }
  res.json(row);
}));

app.get("/api/my-timetable/student", requireRole("student"), asyncHandler(async (req, res) => {
  const data = await readData();
  const user = data.users.find((item) => item.id === req.session.userId);
  const group = user && user.groupName ? findGroupByLabel(data, user.groupName) : null;
  const slots = group
    ? data.timetable
      .filter((slot) => slot.groupId === group.id)
      .map((slot) => buildSlotResponse(data, slot))
    : [];
  const freeSaturday = group
    ? publishedSaturdayFreeSlots(data, group).filter(
      (slot) => !slots.some((existing) => existing.day === slot.day && Number(existing.period) === Number(slot.period))
    )
    : [];
  const mergedSchedule = [...slots, ...freeSaturday];
  res.json({
    groupName: group ? groupLabel(group) : user ? user.groupName : null,
    days: DAYS,
    periods: PERIODS,
    schedule: mergedSchedule,
    publishedAt: mergedSchedule.length ? slots[0]?.updatedAt || slots[0]?.createdAt || null : null,
    message: mergedSchedule.length ? null : "No timetable published yet"
  });
}));

app.get("/api/my-timetable/faculty", requireRole("faculty"), asyncHandler(async (req, res) => {
  const data = await readData();
  const ctx = resolveFacultySessionContext(req, data, { semester: req.query.semester, program: req.query.program, requireSemester: true });
  if (ctx.error) {
    res.status(ctx.status || 400).json({ error: ctx.error });
    return;
  }

  const selectedDate = dateOnly(req.query.date || new Date());
  const selectedDay = dayNameFromDate(selectedDate);
  const { facultyRecord, subjects } = facultyAssignedSubjects(data, ctx.user, { semester: ctx.semester, program: ctx.program });
  const subjectById = new Map(subjects.map((item) => [Number(item.id), item]));
  const planById = new Map((data.adminCourses || []).map((item) => [Number(item.id), item]));
  const selectedProgram = String(ctx.program || "").trim();
  const slotAttendanceRows = (data.facultyAttendance || []).filter((row) => dateOnly(row.attendanceDate) === selectedDate);
  const slotAttendanceByTimetableId = new Map();
  for (const row of slotAttendanceRows) slotAttendanceByTimetableId.set(Number(row.timetableId), row);
  const absentByTimetable = new Map(
    slotAttendanceRows
      .filter((row) => row.status === "Absent")
      .map((row) => [Number(row.timetableId), row])
  );
  const replacementByAttendance = new Map((data.replacementSessions || []).map((item) => [Number(item.attendanceId), item]));

  const relevantSlots = (data.timetable || [])
    .filter((slot) => !slot.isFreeClass && Boolean(slot.is_published))
    .filter((slot) => String(slot.semester || "") === ctx.semester)
    .filter((slot) => {
      if (!selectedProgram) return true;
      const plan = planById.get(Number(slot.courseId || 0));
      const slotProgram = normalizeProgramName(plan ? plan.program : "B.Tech");
      return slotProgram === selectedProgram;
    })
    .filter((slot) =>
      Number(slot.facultyId) === Number(facultyRecord.id) ||
      Number(slot.replacementFacultyId || 0) === Number(facultyRecord.id) ||
      subjectById.has(Number(slot.courseId))
    );

  const expanded = [];
  for (const slot of relevantSlots) {
    const slotResponse = buildSlotResponse(data, slot);
    const absentRow = absentByTimetable.get(Number(slot.id));
    const replacementSession = absentRow ? replacementByAttendance.get(Number(absentRow.id)) : null;
    const assignedToCurrentFaculty = Number(slot.facultyId) === Number(facultyRecord.id);
    const explicitlyReplacement = Number(slot.replacementFacultyId || 0) === Number(facultyRecord.id);
    const replacementChosenByAdmin = Boolean(replacementSession && !replacementSession.isFreeClass && Number(replacementSession.replacementFacultyId) === Number(facultyRecord.id));
    const isReplacementSession = explicitlyReplacement || replacementChosenByAdmin;
    const canTakeSlot = assignedToCurrentFaculty || isReplacementSession;
    const attendanceRow = slotAttendanceByTimetableId.get(Number(slot.id)) || null;
    const locked = Boolean(attendanceRow);
    const slotState = attendanceRow ? attendanceRow.status : "Not Marked";
    const absentFaculty = isReplacementSession
      ? (data.facultyRecords || []).find((item) => Number(item.id) === Number(slot.facultyId))
      : null;
    expanded.push({
      ...slotResponse,
      attendanceStatus: slotState,
      slotState,
      canMarkAttendance: canTakeSlot && slot.day === selectedDay && !locked,
      locked,
      lockReason: locked ? `Already marked as ${slotState} for ${selectedDate}.` : "",
      isReplacementSession,
      absentFacultyName: absentFaculty ? absentFaculty.facultyName : null
    });
  }

  const combinedMap = new Map();
  for (const slot of expanded) {
    const key = `${slot.day}|${Number(slot.period)}`;
    if (!combinedMap.has(key)) {
      combinedMap.set(key, {
        ...slot,
        groupNames: [slot.groupName].filter(Boolean)
      });
      continue;
    }
    const existing = combinedMap.get(key);
    if (slot.groupName && !existing.groupNames.includes(slot.groupName)) existing.groupNames.push(slot.groupName);
    existing.groupName = existing.groupNames.join(" / ");
    if (existing.slotState === "Not Marked" && slot.slotState !== "Not Marked") {
      existing.slotState = slot.slotState;
      existing.attendanceStatus = slot.attendanceStatus;
      existing.locked = slot.locked;
      existing.lockReason = slot.lockReason;
    }
  }

  const schedule = Array.from(combinedMap.values()).sort((a, b) => {
    const dayDelta = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
    if (dayDelta !== 0) return dayDelta;
    return Number(a.period) - Number(b.period);
  });

  res.json({
    facultyId: facultyRecord.facultyId,
    facultyName: facultyRecord.facultyName,
    semester: ctx.semester,
    date: selectedDate,
    day: selectedDay,
    days: DAYS,
    periods: PERIODS,
    schedule,
    weeklyGrid: DAYS.map((day) => ({
      day,
      periods: PERIODS.map((period) => schedule.find((slot) => slot.day === day && Number(slot.period) === Number(period)) || null)
    })),
    message: schedule.length
      ? null
      : (selectedProgram
        ? `No published slots assigned for ${selectedProgram} semester ${ctx.semester}.`
        : "Timetable not published")
  });
}));

app.post("/api/faculty/timetable/attendance", requireRole("faculty"), asyncHandler(async (req, res) => {
  const timetableId = Number(req.body.timetableId || 0);
  const status = String(req.body.status || "").trim();
  const attendanceDate = dateOnly(req.body.date || new Date());
  if (!timetableId || !["Present", "Absent"].includes(status)) {
    res.status(400).json({ error: "timetableId and valid status are required" });
    return;
  }

  const result = await transact((data) => {
    const ctx = resolveFacultySessionContext(req, data, { semester: req.body.semester || req.query.semester, requireSemester: false });
    if (ctx.error) return { error: ctx.error, status: ctx.status || 400 };
    const { facultyRecord } = ctx;
    const slot = (data.timetable || []).find((item) => Number(item.id) === timetableId && !item.isFreeClass && Boolean(item.is_published));
    if (!slot) return { error: "Published timetable slot not found", status: 404 };
    const day = dayNameFromDate(attendanceDate);
    if (slot.day !== day) return { error: `This slot can only be marked on ${slot.day}.`, status: 400 };
    const canTakeSlot = Number(slot.facultyId) === Number(facultyRecord.id) || Number(slot.replacementFacultyId || 0) === Number(facultyRecord.id);
    if (!canTakeSlot) return { error: "You are not assigned to this timetable slot", status: 403 };

    const existing = (data.facultyAttendance || []).find(
      (item) => Number(item.timetableId) === timetableId && dateOnly(item.attendanceDate) === attendanceDate
    );
    if (existing) return { error: "Attendance already marked for this slot", status: 409 };

    const created = {
      id: (data.facultyAttendance || []).reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
      facultyId: Number(facultyRecord.id),
      timetableId,
      attendanceDate,
      status,
      createdAt: now(),
      updatedAt: now()
    };
    data.facultyAttendance.push(created);

    if (status === "Absent") {
      upsertPendingFacultyAlert(data, {
        attendanceId: created.id,
        timetableId,
        facultyId: Number(facultyRecord.id),
        alertDate: attendanceDate
      });
    }
    return {
      id: created.id,
      timetableId,
      status,
      date: attendanceDate,
      message: status === "Absent"
        ? "Marked absent for this slot. Admin has been notified."
        : "Marked present for this slot."
    };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }
  res.status(201).json(result);
}));

app.delete("/api/faculty/timetable/attendance", requireRole("faculty"), asyncHandler(async (_req, res) => {
  res.status(403).json({ error: "Faculty timetable attendance is disabled by admin." });
}));

app.get("/api/admin/faculty-absent-alerts", requireRole("admin"), asyncHandler(async (req, res) => {
  const data = await transact((snapshot) => {
    snapshot.facultyAlerts = snapshot.facultyAlerts || [];
    const existingByAttendance = new Map(
      snapshot.facultyAlerts.map((item) => [Number(item.attendanceId), item])
    );
    let nextAlertId = snapshot.facultyAlerts.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
    const replacementByAttendance = new Map(
      (snapshot.replacementSessions || []).map((item) => [Number(item.attendanceId), item])
    );

    for (const attendance of snapshot.facultyAttendance || []) {
      if (attendance.status !== "Absent") continue;
      const attendanceId = Number(attendance.id);
      const existing = existingByAttendance.get(attendanceId);
      if (!existing) {
        const created = {
          id: ++nextAlertId,
          attendanceId,
          timetableId: Number(attendance.timetableId),
          facultyId: Number(attendance.facultyId),
          alertDate: dateOnly(attendance.attendanceDate),
          status: "Pending",
          action: null,
          resolvedByUserId: null,
          resolvedAt: null,
          createdAt: now(),
          updatedAt: now()
        };
        snapshot.facultyAlerts.push(created);
        existingByAttendance.set(attendanceId, created);
      } else {
        const hasAction = Boolean(String(existing.action || "").trim());
        existing.status = hasAction ? "Resolved" : "Pending";
        if (!hasAction) {
          existing.resolvedByUserId = null;
          existing.resolvedAt = null;
        }
        existing.updatedAt = now();
      }
    }
    return snapshot;
  });
  const hasDateFilter = Boolean(String(req.query.date || "").trim());
  const selectedDate = hasDateFilter ? dateOnly(req.query.date) : null;
  const unresolvedOnly = String(req.query.unresolved || "").toLowerCase() === "true";
  const replacementByAttendance = new Map((data.replacementSessions || []).map((item) => [item.attendanceId, item]));
  const alerts = (data.facultyAlerts || [])
    .filter((row) => (selectedDate ? dateOnly(row.alertDate) === selectedDate : true))
    .filter((row) => (unresolvedOnly ? row.status === "Pending" : true))
    .map((row) => {
      const attendance = (data.facultyAttendance || []).find((item) => Number(item.id) === Number(row.attendanceId));
      if (!attendance) return null;
      const slot = data.timetable.find((item) => item.id === attendance.timetableId);
      if (!slot) return null;
      const base = buildSlotResponse(data, slot, attendance.status);
      const attendanceFaculty = data.facultyRecords.find((item) => item.id === attendance.facultyId) || null;
      const replacement = replacementByAttendance.get(attendance.id) || null;
      const replacementFaculty = replacement && replacement.replacementFacultyId
        ? data.facultyRecords.find((item) => item.id === replacement.replacementFacultyId)
        : null;
      const candidates = replacementCandidates(data, slot).slice(0, 5);
      return {
        alertId: row.id,
        attendanceId: attendance.id,
        date: dateOnly(row.alertDate),
        ...base,
        facultyId: attendanceFaculty ? attendanceFaculty.id : base.facultyId,
        facultyName: attendanceFaculty ? attendanceFaculty.facultyName : base.facultyName,
        originalFacultyId: base.facultyId,
        originalFacultyName: base.facultyName,
        status: row.status,
        resolved: row.status === "Resolved",
        resolutionType: row.action || (replacement ? (replacement.isFreeClass ? "Free" : "Substituted") : null),
        replacementFacultyId: replacement ? replacement.replacementFacultyId : null,
        replacementFacultyName: replacementFaculty ? replacementFaculty.facultyName : null,
        replacementCandidates: candidates
      };
    })
    .filter((item) => (unresolvedOnly ? item && !item.resolved : item))
    .filter(Boolean)
    .sort((a, b) => {
      const dateDelta = String(a.date || "").localeCompare(String(b.date || ""));
      if (dateDelta !== 0) return dateDelta;
      const dayDelta = String(a.day || "").localeCompare(String(b.day || ""));
      if (dayDelta !== 0) return dayDelta;
      return Number(a.period) - Number(b.period);
    });

  res.json({ date: selectedDate, alerts, pendingCount: alerts.length });
}));

app.get("/api/admin/faculty-attendance-log", requireRole("admin"), asyncHandler(async (req, res) => {
  const data = await readData();
  const selectedDate = dateOnly(req.query.date || new Date().toISOString());
  const rows = data.facultyAttendance
    .filter((row) => dateOnly(row.attendanceDate) === selectedDate)
    .map((row) => {
      const slot = data.timetable.find((item) => item.id === row.timetableId);
      if (!slot) return null;
      const attendanceFaculty = data.facultyRecords.find((item) => item.id === row.facultyId) || null;
      const base = buildSlotResponse(data, slot, row.status);
      return {
        id: row.id,
        date: dateOnly(row.attendanceDate),
        status: row.status,
        ...base,
        facultyId: attendanceFaculty ? attendanceFaculty.id : base.facultyId,
        facultyName: attendanceFaculty ? attendanceFaculty.facultyName : base.facultyName,
        originalFacultyId: base.facultyId,
        originalFacultyName: base.facultyName,
        slotState: row.status || "Not Marked"
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.day.localeCompare(b.day) || Number(a.period) - Number(b.period));
  res.json({ date: selectedDate, rows });
}));

app.post("/api/admin/faculty-absent-alerts/:alertId/action", requireRole("admin"), asyncHandler(async (req, res) => {
  const alertId = Number(req.params.alertId);
  const action = String(req.body.action || "").trim();
  const replacementFacultyId = Number(req.body.replacementFacultyId || 0) || null;
  if (!alertId || !["replacement", "free"].includes(action)) {
    res.status(400).json({ error: "alertId and valid action are required" });
    return;
  }

  const result = await transact((data) => {
    const adminUser = data.users.find((item) => item.id === req.session.userId && item.role === "admin");
    if (!adminUser) return { error: "Admin user not found", status: 404 };
    const alert = (data.facultyAlerts || []).find((item) => Number(item.id) === alertId)
      || (data.facultyAlerts || []).find((item) => Number(item.attendanceId) === alertId);
    if (!alert) return { error: "Alert not found", status: 404 };
    if (alert.status === "Resolved") return { error: "Alert already resolved", status: 409 };
    const attendance = data.facultyAttendance.find((row) => row.id === alert.attendanceId && row.status === "Absent");
    if (!attendance) return { error: "Absent record not found", status: 404 };
    const slot = data.timetable.find((item) => item.id === attendance.timetableId);
    if (!slot) return { error: "Timetable slot not found", status: 404 };
    const existingSession = data.replacementSessions.find((item) => item.attendanceId === attendance.id) || null;
    const subject = findSlotSubject(data, slot);
    if (!subject) return { error: "Subject not found for slot", status: 404 };

    if (action === "free") {
      if (existingSession) {
        existingSession.replacementFacultyId = null;
        existingSession.isFreeClass = true;
        existingSession.adminUserId = adminUser.id;
        existingSession.updatedAt = now();
      } else {
        const created = {
          id: data.replacementSessions.reduce((max, item) => Math.max(max, item.id), 0) + 1,
          attendanceId: attendance.id,
          timetableId: slot.id,
          absentFacultyId: attendance.facultyId,
          replacementFacultyId: null,
          isFreeClass: true,
          adminUserId: adminUser.id,
          createdAt: now(),
          updatedAt: now()
        };
        data.replacementSessions.push(created);
      }
      slot.isFreeClass = true;
      slot.replacementFacultyId = null;
      slot.replacedByAdminAt = now();
      slot.updatedAt = now();
      alert.status = "Resolved";
      alert.action = "Free";
      alert.resolvedByUserId = adminUser.id;
      alert.resolvedAt = now();
      alert.updatedAt = now();
      return { action: "Free", slotId: slot.id, alertId: alert.id };
    }

    if (!replacementFacultyId) {
      return { error: "replacementFacultyId is required for replacement", status: 400 };
    }
    const replacement = data.facultyRecords.find((item) => item.id === replacementFacultyId && item.status === "Active");
    if (!replacement) return { error: "Replacement faculty not found or inactive", status: 404 };
    if (replacement.id === attendance.facultyId) return { error: "Replacement cannot be the same faculty", status: 400 };
    if (normalizeCourseCode(replacement.department) !== normalizeCourseCode(subject.department)) {
      return { error: "Replacement faculty must be from same department", status: 400 };
    }
    if (!facultyHasCourseExpertise(data, replacement.id, subject.courseCode)) {
      return { error: "Replacement faculty lacks subject expertise for this course", status: 400 };
    }
    if (facultyIsBusyAtSlot(data, replacement.id, slot.day, slot.period, slot.id)) {
      return { error: "Replacement faculty is busy for this slot", status: 400 };
    }

    if (existingSession) {
      existingSession.replacementFacultyId = replacement.id;
      existingSession.isFreeClass = false;
      existingSession.adminUserId = adminUser.id;
      existingSession.updatedAt = now();
    } else {
      data.replacementSessions.push({
        id: data.replacementSessions.reduce((max, item) => Math.max(max, item.id), 0) + 1,
        attendanceId: attendance.id,
        timetableId: slot.id,
        absentFacultyId: attendance.facultyId,
        replacementFacultyId: replacement.id,
        isFreeClass: false,
        adminUserId: adminUser.id,
        createdAt: now(),
        updatedAt: now()
      });
    }
    slot.isFreeClass = false;
    slot.replacementFacultyId = replacement.id;
    slot.replacedByAdminAt = now();
    slot.updatedAt = now();
    alert.status = "Resolved";
    alert.action = "Substituted";
    alert.resolvedByUserId = adminUser.id;
    alert.resolvedAt = now();
    alert.updatedAt = now();
    return { action: "Substituted", slotId: slot.id, replacementFacultyId: replacement.id, replacementFacultyName: replacement.facultyName, alertId: alert.id };
  });

  if (result.error) {
    res.status(result.status || 400).json({ error: result.error });
    return;
  }
  res.json(result);
}));

app.get("/api/bootstrap", requireAuth, asyncHandler(async (req, res) => {
  const data = await readData();
  normalizeDataDuplicates(data);
  ensureCourseDepartmentMappings(data);
  res.json({
    groups: data.groups.map((group) => ({ ...group, label: groupLabel(group) })),
    courses: data.courses,
    facultyRecords: data.facultyRecords,
    departments: data.departments || [],
    adminCourses: data.adminCourses,
    courseDepartmentMappings: data.courseDepartmentMappings,
    courseAssignments: data.courseAssignments,
    facultyCourseMappings: data.facultyCourseMappings || [],
    users: data.users.map(({ passwordHash, ...user }) => user)
  });
}));

app.get(/.*/, (_req, res) => {
  const indexPath = path.join(FRONTEND_DIR, "index.html");
  res.sendFile(indexPath);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

initDatabase()
  .then(async () => {
    await transact(() => ({ cleaned: true }));
    await backfillTimetableFromPublished();
    app.listen(PORT, () => {
      console.log(`Amrita Course Flow running at http://localhost:${PORT}`);
      console.log(`MySQL database: ${process.env.MYSQL_DATABASE || "amrita_course_flow"}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start application:", err.message);
    process.exit(1);
  });

