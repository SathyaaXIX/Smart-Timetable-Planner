const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

loadEnv();

const DB_NAME = process.env.MYSQL_DATABASE || "amrita_course_flow";
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || ""
};

const TABLES = [
  "users",
  "groups",
  "rooms",
  "facultyRecords",
  "departments",
  "studentRecords",
  "courses",
  "registrations",
  "adminCourses",
  "courseDepartmentMappings",
  "courseAssignments",
  "facultyCourseMappings",
  "timetable",
  "facultyAttendance",
  "facultyAlerts",
  "replacementSessions",
  "publishedTimetables",
  "attendanceRecords"
];

const REAL_FACULTY_RECORDS = [];

const TABLE_CONFIG = {
  users: {
    sql: "users",
    columns: ["name", "username", "passwordHash", "email", "role", "department", "rollNumber", "employeeId", "semester", "groupName", "createdAt"]
  },
  courses: {
    sql: "courses",
    columns: ["code", "name", "department", "program", "academicYear", "credits", "semester", "maxSeats", "facultyId", "description", "isOpen", "createdAt", "updatedAt"],
    booleans: ["isOpen"]
  },
  registrations: {
    sql: "registrations",
    columns: ["courseId", "studentId", "status", "registeredAt"]
  },
  groups: {
    sql: "student_groups",
    columns: ["program", "yearName", "semester", "sectionName", "department", "strength", "status", "createdAt"]
  },
  rooms: {
    sql: "rooms",
    columns: ["roomNumber", "roomType", "roomSpecialization", "capacity", "buildingName", "status", "createdAt"]
  },
  adminCourses: {
    sql: "admin_courses",
    columns: ["courseCode", "courseName", "credits", "program", "academicYear", "semester", "department", "courseType", "theoryHoursPerWeek", "labHoursPerWeek", "requiredRoomSpecialization", "groupName", "status", "createdAt"]
  },
  courseDepartmentMappings: {
    sql: "course_department_mappings",
    columns: ["courseCode", "department", "createdAt"]
  },
  facultyRecords: {
    sql: "faculty_records",
    columns: ["facultyId", "facultyName", "email", "department", "maxWorkload", "status", "facultyPassword", "createdAt"]
  },
  departments: {
    sql: "departments",
    columns: ["departmentName", "status", "createdAt"]
  },
  courseAssignments: {
    sql: "course_assignments",
    columns: ["facultyId", "courseId", "createdAt"]
  },
  facultyCourseMappings: {
    sql: "faculty_course_mappings",
    columns: ["facultyId", "courseCode", "createdAt"]
  },
  timetable: {
    sql: "timetable",
    columns: ["facultyId", "courseId", "groupId", "roomId", "day", "timeSlot", "period", "semester", "replacementFacultyId", "isFreeClass", "is_published", "replacedByAdminAt", "createdAt", "updatedAt"],
    booleans: ["isFreeClass", "is_published"]
  },
  facultyAttendance: {
    sql: "faculty_attendance",
    columns: ["facultyId", "timetableId", "attendanceDate", "status", "createdAt", "updatedAt"]
  },
  facultyAlerts: {
    sql: "faculty_alerts",
    columns: ["attendanceId", "timetableId", "facultyId", "alertDate", "status", "action", "resolvedByUserId", "resolvedAt", "createdAt", "updatedAt"]
  },
  replacementSessions: {
    sql: "replacement_sessions",
    columns: ["attendanceId", "timetableId", "absentFacultyId", "replacementFacultyId", "isFreeClass", "adminUserId", "createdAt", "updatedAt"],
    booleans: ["isFreeClass"]
  },
  studentRecords: {
    sql: "student_records",
    columns: ["rollNumber", "studentName", "studentPassword", "groupId", "yearName", "semester", "sectionName", "status", "email", "department", "createdAt"]
  },
  publishedTimetables: {
    sql: "published_timetables",
    columns: ["groupName", "schedule", "publishedAt"],
    json: ["schedule"]
  },
  attendanceRecords: {
    sql: "attendance_records",
    columns: ["facultyRecordId", "assignmentId", "studentRecordId", "courseId", "attendanceDate", "status", "createdAt", "updatedAt"]
  }
};

let pool;

function loadEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = trimmed.slice(equals + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function now() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function mysqlDate(value) {
  if (!value) return now();
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace("T", " ");
  return String(value).replace("T", " ").replace("Z", "").slice(0, 19);
}

function configFor(tableName) {
  const config = TABLE_CONFIG[tableName];
  if (!config) throw new Error(`Unknown table "${tableName}"`);
  return config;
}

function encodeRow(tableName, values) {
  const config = configFor(tableName);
  const row = {};
  for (const [key, value] of Object.entries(values)) {
    if (config.json && config.json.includes(key)) {
      row[key] = JSON.stringify(value || []);
    } else if (config.booleans && config.booleans.includes(key)) {
      row[key] = value ? 1 : 0;
    } else if (key.endsWith("At")) {
      row[key] = mysqlDate(value);
    } else {
      row[key] = value;
    }
  }
  return row;
}

function decodeRow(tableName, row) {
  if (!row) return null;
  const config = configFor(tableName);
  const output = { ...row };
  for (const key of config.json || []) {
    output[key] = typeof output[key] === "string" ? JSON.parse(output[key] || "[]") : output[key] || [];
  }
  for (const key of config.booleans || []) {
    output[key] = Boolean(output[key]);
  }
  for (const key of Object.keys(output)) {
    if (key.endsWith("At") && output[key] instanceof Date) {
      output[key] = output[key].toISOString();
    }
  }
  return output;
}

function buildRealFacultyRecords(createdAtValue) {
  return REAL_FACULTY_RECORDS.map((record, index) => ({
    id: index + 1,
    ...record,
    createdAt: createdAtValue
  }));
}

function defaultData() {
  const createdAt = now();
  return {
    users: [
      {
        id: 1,
        name: "System Administrator",
        username: "admin",
        passwordHash: hashPassword("admin123"),
        email: "admin@amrita.edu",
        role: "admin",
        department: "Administration",
        rollNumber: null,
        employeeId: null,
        semester: null,
        groupName: null,
        createdAt
      }
    ],
    courses: [],
    registrations: [],
    groups: [],
    rooms: [],
    adminCourses: [],
    courseDepartmentMappings: [],
    facultyRecords: [],
    departments: [],
    courseAssignments: [],
    facultyCourseMappings: [],
    timetable: [],
    facultyAttendance: [],
    facultyAlerts: [],
    replacementSessions: [],
    studentRecords: [],
    publishedTimetables: [],
    attendanceRecords: []
  };
}

async function initDatabase() {
  const server = await mysql.createConnection(MYSQL_CONFIG);
  await server.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await server.end();

  pool = mysql.createPool({
    ...MYSQL_CONFIG,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    multipleStatements: true
  });

  const schema = fs.readFileSync(path.join(__dirname, "..", "..", "db", "schema.sql"), "utf8");
  await pool.query(schema);
  await applyRuntimeMigrations();
  await seedIfEmpty();
  await syncDepartmentsSnapshot();
}

async function applyRuntimeMigrations() {
  await pool.query("CREATE TABLE IF NOT EXISTS departments (id INT AUTO_INCREMENT PRIMARY KEY, departmentName VARCHAR(120) NOT NULL UNIQUE, status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)");

  const [yearCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_records' AND COLUMN_NAME = 'yearName' LIMIT 1",
    [DB_NAME]
  );
  if (!yearCol.length) {
    await pool.query("ALTER TABLE student_records ADD COLUMN yearName VARCHAR(40) NULL");
  }

  const [sectionCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_records' AND COLUMN_NAME = 'sectionName' LIMIT 1",
    [DB_NAME]
  );
  if (!sectionCol.length) {
    await pool.query("ALTER TABLE student_records ADD COLUMN sectionName VARCHAR(80) NULL");
  }
  const [studentSemesterCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_records' AND COLUMN_NAME = 'semester' LIMIT 1",
    [DB_NAME]
  );
  if (!studentSemesterCol.length) {
    await pool.query("ALTER TABLE student_records ADD COLUMN semester VARCHAR(8) NULL");
  }
  await pool.query(`
    UPDATE student_records
    SET semester = CASE
      WHEN semester IS NOT NULL AND semester <> '' THEN semester
      WHEN yearName LIKE '1%' THEN '1'
      WHEN yearName LIKE '2%' THEN '3'
      WHEN yearName LIKE '3%' THEN '5'
      WHEN yearName LIKE '4%' THEN '7'
      ELSE semester
    END
    WHERE semester IS NULL OR semester = ''
  `);
  const [groupSemesterCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_groups' AND COLUMN_NAME = 'semester' LIMIT 1",
    [DB_NAME]
  );
  if (!groupSemesterCol.length) {
    await pool.query("ALTER TABLE student_groups ADD COLUMN semester VARCHAR(8) NULL");
  }
  const [groupProgramCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_groups' AND COLUMN_NAME = 'program' LIMIT 1",
    [DB_NAME]
  );
  if (!groupProgramCol.length) {
    await pool.query("ALTER TABLE student_groups ADD COLUMN program VARCHAR(20) NOT NULL DEFAULT 'B.Tech'");
  }
  await pool.query(`
    UPDATE student_groups
    SET semester = CASE
      WHEN semester IS NOT NULL AND semester <> '' THEN semester
      WHEN yearName LIKE '1%' THEN '1'
      WHEN yearName LIKE '2%' THEN '3'
      WHEN yearName LIKE '3%' THEN '5'
      WHEN yearName LIKE '4%' THEN '7'
      ELSE semester
    END
    WHERE semester IS NULL OR semester = ''
  `);
  await pool.query(`
    UPDATE student_groups
    SET program = CASE
      WHEN program IS NOT NULL AND program <> '' THEN program
      WHEN UPPER(yearName) LIKE 'MTECH%' OR UPPER(yearName) LIKE 'M.TECH%' THEN 'M.Tech'
      ELSE 'B.Tech'
    END
    WHERE program IS NULL OR program = ''
  `);
  await pool.query(`
    UPDATE student_groups
    SET yearName = TRIM(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(yearName, 'MTech ', ''),
          'MTECH ', ''),
        'M.Tech ', ''),
      'M.TECH ', '')
    )
    WHERE UPPER(yearName) LIKE 'MTECH%' OR UPPER(yearName) LIKE 'M.TECH%'
  `);
  const [adminCourseSemesterCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'admin_courses' AND COLUMN_NAME = 'semester' LIMIT 1",
    [DB_NAME]
  );
  if (!adminCourseSemesterCol.length) {
    await pool.query("ALTER TABLE admin_courses ADD COLUMN semester VARCHAR(8) NULL");
  }
  const [adminCourseProgramCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'admin_courses' AND COLUMN_NAME = 'program' LIMIT 1",
    [DB_NAME]
  );
  if (!adminCourseProgramCol.length) {
    await pool.query("ALTER TABLE admin_courses ADD COLUMN program VARCHAR(20) NOT NULL DEFAULT 'B.Tech'");
  }
  const [courseAcademicYearCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'academicYear' LIMIT 1",
    [DB_NAME]
  );
  if (!courseAcademicYearCol.length) {
    await pool.query("ALTER TABLE courses ADD COLUMN academicYear VARCHAR(40) NULL");
  }
  const [courseProgramCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'program' LIMIT 1",
    [DB_NAME]
  );
  if (!courseProgramCol.length) {
    await pool.query("ALTER TABLE courses ADD COLUMN program VARCHAR(20) NOT NULL DEFAULT 'B.Tech'");
  }
  await pool.query(`
    UPDATE courses
    SET academicYear = CASE
      WHEN academicYear IS NOT NULL AND academicYear <> '' THEN academicYear
      WHEN CAST(semester AS UNSIGNED) BETWEEN 1 AND 2 THEN '1st Year'
      WHEN CAST(semester AS UNSIGNED) BETWEEN 3 AND 4 THEN '2nd Year'
      WHEN CAST(semester AS UNSIGNED) BETWEEN 5 AND 6 THEN '3rd Year'
      WHEN CAST(semester AS UNSIGNED) BETWEEN 7 AND 8 THEN '4th Year'
      ELSE academicYear
    END
    WHERE academicYear IS NULL OR academicYear = ''
  `);
  await pool.query(`
    UPDATE courses
    SET program = CASE
      WHEN program IS NOT NULL AND program <> '' THEN program
      WHEN UPPER(academicYear) LIKE 'MTECH%' OR UPPER(academicYear) LIKE 'M.TECH%' THEN 'M.Tech'
      ELSE 'B.Tech'
    END
    WHERE program IS NULL OR program = ''
  `);
  await pool.query(`
    UPDATE courses
    SET academicYear = TRIM(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(academicYear, 'MTech ', ''),
          'MTECH ', ''),
        'M.Tech ', ''),
      'M.TECH ', '')
    )
    WHERE UPPER(academicYear) LIKE 'MTECH%' OR UPPER(academicYear) LIKE 'M.TECH%'
  `);
  await pool.query(`
    UPDATE admin_courses ac
    LEFT JOIN student_groups sg ON UPPER(TRIM(ac.groupName)) = UPPER(TRIM(CONCAT(sg.yearName, ' - ', sg.sectionName, ' (', sg.department, ')')))
    SET ac.program = CASE
      WHEN ac.program IS NOT NULL AND ac.program <> '' THEN ac.program
      WHEN sg.program IS NOT NULL AND sg.program <> '' THEN sg.program
      ELSE 'B.Tech'
    END
    WHERE ac.program IS NULL OR ac.program = ''
  `);

  const [dayCol] = await pool.query(
    "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'timetable' AND COLUMN_NAME = 'day' LIMIT 1",
    [DB_NAME]
  );
  const dayType = dayCol.length ? String(dayCol[0].COLUMN_TYPE || "") : "";
  if (dayType && !dayType.includes("Saturday")) {
    await pool.query("ALTER TABLE timetable MODIFY COLUMN day ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday') NOT NULL");
  }
  const [timetableSemesterCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'timetable' AND COLUMN_NAME = 'semester' LIMIT 1",
    [DB_NAME]
  );
  if (!timetableSemesterCol.length) {
    await pool.query("ALTER TABLE timetable ADD COLUMN semester VARCHAR(8) NULL");
  }
  const [timetablePublishedCol] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'timetable' AND COLUMN_NAME = 'is_published' LIMIT 1",
    [DB_NAME]
  );
  if (!timetablePublishedCol.length) {
    await pool.query("ALTER TABLE timetable ADD COLUMN is_published TINYINT(1) NOT NULL DEFAULT 0");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS faculty_alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      attendanceId INT NOT NULL UNIQUE,
      timetableId INT NOT NULL,
      facultyId INT NOT NULL,
      alertDate DATE NOT NULL,
      status ENUM('Pending', 'Resolved') NOT NULL DEFAULT 'Pending',
      action ENUM('Free', 'Substituted') NULL,
      resolvedByUserId INT NULL,
      resolvedAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_faculty_alerts_attendance FOREIGN KEY (attendanceId) REFERENCES faculty_attendance(id) ON DELETE CASCADE,
      CONSTRAINT fk_faculty_alerts_timetable FOREIGN KEY (timetableId) REFERENCES timetable(id) ON DELETE CASCADE,
      CONSTRAINT fk_faculty_alerts_faculty FOREIGN KEY (facultyId) REFERENCES faculty_records(id) ON DELETE CASCADE,
      CONSTRAINT fk_faculty_alerts_resolved_user FOREIGN KEY (resolvedByUserId) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    INSERT INTO faculty_alerts (
      attendanceId, timetableId, facultyId, alertDate, status, action, resolvedByUserId, resolvedAt, createdAt, updatedAt
    )
    SELECT
      fa.id AS attendanceId,
      fa.timetableId,
      fa.facultyId,
      fa.attendanceDate AS alertDate,
      'Pending' AS status,
      NULL AS action,
      NULL AS resolvedByUserId,
      NULL AS resolvedAt,
      NOW() AS createdAt,
      NOW() AS updatedAt
    FROM faculty_attendance fa
    LEFT JOIN faculty_alerts fal ON fal.attendanceId = fa.id
    WHERE fa.status = 'Absent' AND fal.id IS NULL
  `);

  await pool.query(`
    UPDATE faculty_alerts
    SET
      status = CASE WHEN action IS NULL THEN 'Pending' ELSE 'Resolved' END,
      resolvedByUserId = CASE WHEN action IS NULL THEN NULL ELSE resolvedByUserId END,
      resolvedAt = CASE WHEN action IS NULL THEN NULL ELSE resolvedAt END
  `);
}

async function seedIfEmpty() {
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM users");
  if (rows[0].count > 0) return;

  const oldJson = path.join(__dirname, "..", "..", "data", "data.json");
  const seed = fs.existsSync(oldJson) ? JSON.parse(fs.readFileSync(oldJson, "utf8")) : defaultData();
  await saveSnapshot(seed);
}

function hasRealFacultySnapshot(records) {
  const ids = new Set(records.map((record) => String(record.facultyId || "").toUpperCase()));
  return REAL_FACULTY_RECORDS.every((record) => ids.has(record.facultyId));
}

async function syncRealFacultySnapshot() {
  const existing = await list("facultyRecords");
  if (hasRealFacultySnapshot(existing)) return;

  await transact((data) => {
    let nextId = data.facultyRecords.reduce((max, item) => Math.max(max, item.id), 0);
    for (const template of REAL_FACULTY_RECORDS) {
      const facultyId = template.facultyId.toUpperCase();
      let record = data.facultyRecords.find((item) => String(item.facultyId).toUpperCase() === facultyId);
      if (!record) {
        record = {
          id: ++nextId,
          ...template,
          createdAt: now()
        };
        data.facultyRecords.push(record);
      } else {
        record.facultyName = template.facultyName;
        record.email = template.email;
        record.department = template.department;
        record.maxWorkload = template.maxWorkload;
        record.status = template.status;
        if (!record.facultyPassword) record.facultyPassword = template.facultyPassword;
      }
      syncFacultyToUser(data, record);
    }
    return { synced: true };
  });
}

async function syncDepartmentsSnapshot() {
  await transact((data) => {
    if (!Array.isArray(data.departments)) data.departments = [];
    const known = new Set(data.departments.map((item) => String(item.departmentName || "").trim().toUpperCase()));
    let nextId = data.departments.reduce((max, item) => Math.max(max, item.id), 0);
    const addDepartment = (name) => {
      const normalized = String(name || "").trim();
      if (!normalized) return;
      const key = normalized.toUpperCase();
      if (known.has(key)) return;
      known.add(key);
      data.departments.push({ id: ++nextId, departmentName: normalized, status: "Active", createdAt: now() });
    };
    for (const group of data.groups || []) addDepartment(group.department);
    for (const faculty of data.facultyRecords || []) addDepartment(faculty.department);
    for (const student of data.studentRecords || []) addDepartment(student.department);
    return { synced: true };
  });
}

async function readData(connection = pool) {
  const data = {};
  for (const tableName of TABLES) {
    data[tableName] = await list(tableName, connection);
  }
  return data;
}

async function list(tableName, connection = pool) {
  const config = configFor(tableName);
  const [rows] = await connection.query(`SELECT * FROM \`${config.sql}\` ORDER BY id`);
  return rows.map((row) => decodeRow(tableName, row));
}

async function get(tableName, id, connection = pool) {
  const config = configFor(tableName);
  const [rows] = await connection.query(`SELECT * FROM \`${config.sql}\` WHERE id = ? LIMIT 1`, [Number(id)]);
  return decodeRow(tableName, rows[0] || null);
}

async function insert(tableName, values, connection = pool) {
  const config = configFor(tableName);
  const encoded = encodeRow(tableName, values);
  const columns = Object.keys(encoded);
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO \`${config.sql}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`;
  const [result] = await connection.query(sql, columns.map((column) => encoded[column]));
  return get(tableName, result.insertId, connection);
}

async function update(tableName, id, values, connection = pool) {
  const config = configFor(tableName);
  const encoded = encodeRow(tableName, values);
  const columns = Object.keys(encoded);
  if (columns.length === 0) return get(tableName, id, connection);
  const assignments = columns.map((column) => `\`${column}\` = ?`).join(", ");
  await connection.query(
    `UPDATE \`${config.sql}\` SET ${assignments} WHERE id = ?`,
    [...columns.map((column) => encoded[column]), Number(id)]
  );
  return get(tableName, id, connection);
}

async function remove(tableName, id, connection = pool) {
  const current = await get(tableName, id, connection);
  if (!current) return null;
  const config = configFor(tableName);
  await connection.query(`DELETE FROM \`${config.sql}\` WHERE id = ?`, [Number(id)]);
  return current;
}

async function saveSnapshot(data, connection = pool) {
  const reverseTables = [...TABLES].reverse();
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const tableName of reverseTables) {
    await connection.query(`DELETE FROM \`${configFor(tableName).sql}\``);
  }
  for (const tableName of TABLES) {
    const rows = data[tableName] || [];
    for (const row of rows) {
      const config = configFor(tableName);
      const encoded = encodeRow(tableName, row);
      const columns = ["id", ...config.columns].filter((column) => Object.prototype.hasOwnProperty.call(encoded, column) || column === "id");
      const placeholders = columns.map(() => "?").join(", ");
      await connection.query(
        `INSERT INTO \`${config.sql}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`,
        columns.map((column) => (column === "id" ? row.id : encoded[column]))
      );
    }
  }
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
}

async function transact(mutator) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const data = await readData(connection);
    const result = await mutator(data);
    await saveSnapshot(data, connection);
    await connection.commit();
    if (typeof result === "undefined") return null;
    return JSON.parse(JSON.stringify(result));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function groupLabel(group) {
  if (!group) return null;
  const program = String(group.program || "B.Tech").trim();
  return `${program} ${group.yearName} - ${group.sectionName} (${group.department})`;
}

function syncStudentToUser(data, record) {
  const username = record.rollNumber.toLowerCase();
  const group = data.groups.find((item) => item.id === record.groupId);
  const existing = data.users.find(
    (user) => user.role === "student" && user.rollNumber === record.rollNumber
  );
  const userData = {
    name: record.studentName,
    username,
    passwordHash: hashPassword(record.studentPassword),
    email: record.email || `${username}@students.amrita.edu`,
    role: "student",
    department: record.department,
    rollNumber: record.rollNumber,
    semester: null,
    employeeId: null,
    groupName: groupLabel(group)
  };

  if (existing) {
    Object.assign(existing, userData);
    return existing;
  }

  const created = {
    id: data.users.reduce((max, user) => Math.max(max, user.id), 0) + 1,
    ...userData,
    createdAt: now()
  };
  data.users.push(created);
  return created;
}

function syncFacultyToUser(data, record) {
  const username = record.facultyId.toLowerCase();
  const existing = data.users.find(
    (user) => user.role === "faculty" && user.employeeId === record.facultyId
  );
  const existingByEmail = data.users.find(
    (user) => String(user.email || "").trim().toLowerCase() === String(record.email || "").trim().toLowerCase()
  );
  const existingByUsername = data.users.find(
    (user) => String(user.username || "").trim().toLowerCase() === username
  );
  const userData = {
    name: record.facultyName,
    username,
    passwordHash: hashPassword(record.facultyPassword || "faculty123"),
    email: record.email,
    role: "faculty",
    department: record.department,
    employeeId: record.facultyId,
    rollNumber: null,
    semester: null,
    groupName: null
  };

  if (existing) {
    Object.assign(existing, userData);
    return existing;
  }

  // Recover gracefully when a faculty account already exists under same email/username.
  // This avoids startup crashes due to users.email unique constraint violations.
  const reusable = existingByEmail || existingByUsername;
  if (reusable) {
    Object.assign(reusable, userData);
    return reusable;
  }

  const created = {
    id: data.users.reduce((max, user) => Math.max(max, user.id), 0) + 1,
    ...userData,
    createdAt: now()
  };
  data.users.push(created);
  return created;
}

module.exports = {
  initDatabase,
  hashPassword,
  now,
  readData,
  list,
  get,
  insert,
  update,
  remove,
  transact,
  groupLabel,
  syncStudentToUser,
  syncFacultyToUser
};
