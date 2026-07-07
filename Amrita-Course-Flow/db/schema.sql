CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  username VARCHAR(120) NOT NULL UNIQUE,
  passwordHash VARCHAR(128) NOT NULL,
  email VARCHAR(180) NOT NULL UNIQUE,
  role ENUM('admin', 'faculty', 'student') NOT NULL,
  department VARCHAR(120),
  rollNumber VARCHAR(80),
  employeeId VARCHAR(80),
  semester VARCHAR(40),
  groupName VARCHAR(180),
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program VARCHAR(20) NOT NULL DEFAULT 'B.Tech',
  yearName VARCHAR(40) NOT NULL,
  sectionName VARCHAR(80) NOT NULL,
  department VARCHAR(120) NOT NULL,
  strength INT NOT NULL,
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  roomNumber VARCHAR(80) NOT NULL,
  roomType ENUM('Classroom', 'Lab', 'Seminar Hall') NOT NULL,
  roomSpecialization ENUM('General Classroom', 'Computer Lab', 'AI/ML Lab', 'Electronics Lab', 'Seminar Hall') NOT NULL DEFAULT 'General Classroom',
  capacity INT NOT NULL,
  buildingName VARCHAR(140) NOT NULL,
  status ENUM('Available', 'Maintenance', 'Inactive') NOT NULL DEFAULT 'Available',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS faculty_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  facultyId VARCHAR(80) NOT NULL UNIQUE,
  facultyName VARCHAR(160) NOT NULL,
  email VARCHAR(180) NOT NULL,
  department VARCHAR(120) NOT NULL,
  maxWorkload INT NOT NULL,
  status ENUM('Active', 'On Leave', 'Inactive') NOT NULL DEFAULT 'Active',
  facultyPassword VARCHAR(120) NOT NULL DEFAULT 'faculty123',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rollNumber VARCHAR(80) NOT NULL UNIQUE,
  studentName VARCHAR(160) NOT NULL,
  studentPassword VARCHAR(120) NOT NULL DEFAULT 'student123',
  groupId INT,
  yearName VARCHAR(40),
  sectionName VARCHAR(80),
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  email VARCHAR(180),
  department VARCHAR(120),
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_student_records_group FOREIGN KEY (groupId) REFERENCES student_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  departmentName VARCHAR(120) NOT NULL UNIQUE,
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(180) NOT NULL,
  department VARCHAR(120) NOT NULL,
  program VARCHAR(20) NOT NULL DEFAULT 'B.Tech',
  academicYear VARCHAR(40) NULL,
  credits INT NOT NULL,
  semester VARCHAR(40) NOT NULL,
  maxSeats INT NOT NULL,
  facultyId INT,
  description TEXT,
  isOpen TINYINT(1) NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_courses_faculty_user FOREIGN KEY (facultyId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS registrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  courseId INT NOT NULL,
  studentId INT NOT NULL,
  status ENUM('registered', 'dropped', 'completed') NOT NULL DEFAULT 'registered',
  registeredAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_registrations_course FOREIGN KEY (courseId) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT fk_registrations_student_user FOREIGN KEY (studentId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  courseCode VARCHAR(80) NOT NULL,
  courseName VARCHAR(180) NOT NULL,
  credits INT NOT NULL,
  program VARCHAR(20) NOT NULL DEFAULT 'B.Tech',
  academicYear VARCHAR(40) NOT NULL,
  department VARCHAR(120) NOT NULL,
  courseType ENUM('Theory', 'Lab', 'Theory + Lab') NOT NULL,
  theoryHoursPerWeek INT NOT NULL DEFAULT 0,
  labHoursPerWeek INT NOT NULL DEFAULT 0,
  requiredRoomSpecialization ENUM('General Classroom', 'Computer Lab', 'AI/ML Lab', 'Electronics Lab', 'Seminar Hall') NOT NULL DEFAULT 'General Classroom',
  groupName VARCHAR(180) NOT NULL,
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS course_department_mappings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  courseCode VARCHAR(80) NOT NULL,
  department VARCHAR(120) NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_course_department (courseCode, department)
);

CREATE TABLE IF NOT EXISTS course_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  facultyId INT NOT NULL,
  courseId INT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_course_assignments_faculty FOREIGN KEY (facultyId) REFERENCES faculty_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_course_assignments_admin_course FOREIGN KEY (courseId) REFERENCES admin_courses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS faculty_course_mappings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  facultyId INT NOT NULL,
  courseCode VARCHAR(80) NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_faculty_course_mapping (facultyId, courseCode),
  CONSTRAINT fk_faculty_course_mapping_faculty FOREIGN KEY (facultyId) REFERENCES faculty_records(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timetable (
  id INT AUTO_INCREMENT PRIMARY KEY,
  facultyId INT NOT NULL,
  courseId INT NOT NULL,
  groupId INT,
  roomId INT,
  day ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday') NOT NULL,
  timeSlot VARCHAR(32) NOT NULL,
  period INT NOT NULL,
  replacementFacultyId INT,
  isFreeClass TINYINT(1) NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  replacedByAdminAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_timetable_group_day_period (groupId, day, period),
  CONSTRAINT fk_timetable_faculty FOREIGN KEY (facultyId) REFERENCES faculty_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_timetable_course FOREIGN KEY (courseId) REFERENCES admin_courses(id) ON DELETE CASCADE,
  CONSTRAINT fk_timetable_group FOREIGN KEY (groupId) REFERENCES student_groups(id) ON DELETE SET NULL,
  CONSTRAINT fk_timetable_room FOREIGN KEY (roomId) REFERENCES rooms(id) ON DELETE SET NULL,
  CONSTRAINT fk_timetable_replacement_faculty FOREIGN KEY (replacementFacultyId) REFERENCES faculty_records(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS faculty_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  facultyId INT NOT NULL,
  timetableId INT NOT NULL,
  attendanceDate DATE NOT NULL,
  status ENUM('Present', 'Absent') NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_faculty_attendance_per_day (facultyId, timetableId, attendanceDate),
  CONSTRAINT fk_faculty_attendance_faculty FOREIGN KEY (facultyId) REFERENCES faculty_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_faculty_attendance_timetable FOREIGN KEY (timetableId) REFERENCES timetable(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS replacement_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attendanceId INT NOT NULL UNIQUE,
  timetableId INT NOT NULL,
  absentFacultyId INT NOT NULL,
  replacementFacultyId INT,
  isFreeClass TINYINT(1) NOT NULL DEFAULT 0,
  adminUserId INT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_replacement_attendance FOREIGN KEY (attendanceId) REFERENCES faculty_attendance(id) ON DELETE CASCADE,
  CONSTRAINT fk_replacement_timetable FOREIGN KEY (timetableId) REFERENCES timetable(id) ON DELETE CASCADE,
  CONSTRAINT fk_replacement_absent_faculty FOREIGN KEY (absentFacultyId) REFERENCES faculty_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_replacement_new_faculty FOREIGN KEY (replacementFacultyId) REFERENCES faculty_records(id) ON DELETE SET NULL,
  CONSTRAINT fk_replacement_admin_user FOREIGN KEY (adminUserId) REFERENCES users(id) ON DELETE CASCADE
);

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
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  facultyRecordId INT NOT NULL,
  assignmentId INT NOT NULL,
  studentRecordId INT NOT NULL,
  courseId INT,
  attendanceDate DATE NOT NULL,
  status ENUM('Present', 'Absent') NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_assignment_student_day (assignmentId, studentRecordId, attendanceDate),
  CONSTRAINT fk_attendance_faculty_record FOREIGN KEY (facultyRecordId) REFERENCES faculty_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_assignment FOREIGN KEY (assignmentId) REFERENCES admin_courses(id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_student_record FOREIGN KEY (studentRecordId) REFERENCES student_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_course FOREIGN KEY (courseId) REFERENCES courses(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS published_timetables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  groupName VARCHAR(180) NOT NULL UNIQUE,
  schedule JSON NOT NULL,
  publishedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
