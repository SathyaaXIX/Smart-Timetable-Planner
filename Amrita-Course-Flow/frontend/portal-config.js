export const roleNav = {
  admin: [
    ["Dashboard", "/admin/dashboard"],
    ["Departments", "/admin/departments"],
    ["Students", "/admin/students"],
    ["Registration Courses", "/admin/courses"],
    ["Faculty", "/admin/faculty"],
    ["Rooms", "/admin/rooms"],
    ["Teaching Plan", "/admin/settings"],
    ["Timetable", "/admin/timetable"],
    ["Faculty Alerts", "/admin/faculty-alerts"],
    ["Reports", "/admin/reports"],
    ["Profile", "/admin/profile"]
  ],
  faculty: [
    ["Dashboard", "/faculty/dashboard"],
    ["Assigned Subjects", "/faculty/subjects"],
    ["Timetable", "/faculty/timetable"],
    ["Students", "/faculty/students"],
    ["Attendance", "/faculty/attendance"],
    ["Profile", "/faculty/profile"]
  ],
  student: [
    ["Dashboard", "/student/dashboard"],
    ["Courses", "/student/courses"],
    ["Timetable", "/student/timetable"],
    ["Attendance", "/student/attendance"],
    ["Profile", "/student/profile"]
  ]
};

export const options = {
  program: ["B.Tech", "M.Tech"],
  yearName: ["1st Year", "2nd Year", "3rd Year", "4th Year"],
  semester: ["1", "2", "3", "4", "5", "6", "7", "8"],
  academicYear: ["1st Year", "2nd Year", "3rd Year", "4th Year"],
  sectionName: ["A", "B", "C"],
  streamName: ["Medical", "Non-Medical"],
  groupStatus: ["Active", "Inactive"],
  studentStatus: ["Active", "Inactive"],
  courseStatus: ["Active", "Inactive"],
  facultyStatus: ["Active", "On Leave", "Inactive"],
  roomType: ["Classroom", "Lab", "Seminar Hall"],
  roomSpecialization: ["General Classroom", "Computer Lab", "AI/ML Lab", "Electronics Lab", "Seminar Hall"],
  courseType: ["Theory", "Lab", "Theory + Lab"],
  roomStatus: ["Available", "Maintenance", "Inactive"]
};
