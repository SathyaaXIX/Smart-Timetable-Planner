const {
  initDatabase,
  transact,
  now,
  hashPassword,
  groupLabel,
  syncFacultyToUser,
  syncStudentToUser
} = require("../backend/models/database");

function makeFacultyTemplates() {
  return [
    { facultyId: "FAC101", facultyName: "Dr. Aarav Menon", email: "aarav.menon@amrita.edu", department: "Computer Science", maxWorkload: 12, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC102", facultyName: "Dr. Nisha Pillai", email: "nisha.pillai@amrita.edu", department: "Computer Science", maxWorkload: 11, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC103", facultyName: "Dr. Rohan Iyer", email: "rohan.iyer@amrita.edu", department: "Computer Science", maxWorkload: 10, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC104", facultyName: "Dr. Kavya Suresh", email: "kavya.suresh@amrita.edu", department: "Computer Science", maxWorkload: 9, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC201", facultyName: "Dr. Meera Krishnan", email: "meera.krishnan@amrita.edu", department: "AI and DS", maxWorkload: 12, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC202", facultyName: "Dr. Aditya Nair", email: "aditya.nair@amrita.edu", department: "AI and DS", maxWorkload: 10, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC203", facultyName: "Dr. Priya Balaji", email: "priya.balaji@amrita.edu", department: "AI and DS", maxWorkload: 11, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC204", facultyName: "Dr. Vivek Sharma", email: "vivek.sharma@amrita.edu", department: "AI and DS", maxWorkload: 9, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC301", facultyName: "Dr. Sidharth Rao", email: "sidharth.rao@amrita.edu", department: "Electronics and Communication", maxWorkload: 12, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC302", facultyName: "Dr. Pooja Nambiar", email: "pooja.nambiar@amrita.edu", department: "Electronics and Communication", maxWorkload: 10, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC303", facultyName: "Dr. Arun Verma", email: "arun.verma@amrita.edu", department: "Electronics and Communication", maxWorkload: 11, status: "Active", facultyPassword: "faculty123" },
    { facultyId: "FAC304", facultyName: "Dr. Sneha Joseph", email: "sneha.joseph@amrita.edu", department: "Electronics and Communication", maxWorkload: 9, status: "Active", facultyPassword: "faculty123" }
  ];
}

function makeCourseTemplates() {
  return [
    { code: "CSE201", name: "Data Structures", department: "Computer Science", credits: 4, semester: "3", maxSeats: 80, description: "Core DS concepts and applications." },
    { code: "CSE203", name: "Database Management Systems", department: "Computer Science", credits: 4, semester: "3", maxSeats: 80, description: "Relational design and SQL." },
    { code: "CSE205", name: "Operating Systems", department: "Computer Science", credits: 4, semester: "3", maxSeats: 80, description: "Processes, memory and scheduling." },
    { code: "CSE207", name: "Computer Networks", department: "Computer Science", credits: 3, semester: "3", maxSeats: 80, description: "Protocols and network layers." },
    { code: "CSE209", name: "Software Engineering", department: "Computer Science", credits: 3, semester: "3", maxSeats: 80, description: "Lifecycle and software quality." },
    { code: "AID201", name: "Python for Data Science", department: "AI and DS", credits: 4, semester: "3", maxSeats: 80, description: "Python stack for analytics." },
    { code: "AID203", name: "Machine Learning", department: "AI and DS", credits: 4, semester: "3", maxSeats: 80, description: "Supervised and unsupervised ML." },
    { code: "AID205", name: "Data Visualization", department: "AI and DS", credits: 3, semester: "3", maxSeats: 80, description: "Dashboards and visual storytelling." },
    { code: "AID207", name: "Statistics for AI", department: "AI and DS", credits: 3, semester: "3", maxSeats: 80, description: "Probability and inference." },
    { code: "AID209", name: "Deep Learning Basics", department: "AI and DS", credits: 4, semester: "3", maxSeats: 80, description: "Neural networks fundamentals." },
    { code: "ECE201", name: "Signals and Systems", department: "Electronics and Communication", credits: 4, semester: "3", maxSeats: 80, description: "Signal analysis methods." },
    { code: "ECE203", name: "Digital Electronics", department: "Electronics and Communication", credits: 4, semester: "3", maxSeats: 80, description: "Combinational and sequential logic." },
    { code: "ECE205", name: "Microprocessors", department: "Electronics and Communication", credits: 4, semester: "3", maxSeats: 80, description: "Processor architecture and interfacing." },
    { code: "ECE207", name: "Communication Theory", department: "Electronics and Communication", credits: 3, semester: "3", maxSeats: 80, description: "Analog and digital communication." },
    { code: "ECE209", name: "Embedded Systems", department: "Electronics and Communication", credits: 3, semester: "3", maxSeats: 80, description: "Embedded design workflow." }
  ];
}

function main() {
  return initDatabase().then(async () => {
    const summary = await transact((data) => {
      const createdAt = now();

      const departments = ["Computer Science", "AI and DS", "Electronics and Communication"];
      const years = ["1st Year", "2nd Year"];
      const sections = ["A", "B"];

      data.users = [
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
      ];
      data.registrations = [];
      data.adminCourses = [];
      data.courseAssignments = [];
      data.facultyCourseMappings = [];
      data.timetable = [];
      data.facultyAttendance = [];
      data.replacementSessions = [];
      data.publishedTimetables = [];
      data.attendanceRecords = [];

      data.departments = departments.map((departmentName, index) => ({
        id: index + 1,
        departmentName,
        status: "Active",
        createdAt
      }));

      let groupId = 0;
      data.groups = [];
      for (const department of departments) {
        for (const yearName of years) {
          for (const sectionName of sections) {
            groupId += 1;
            data.groups.push({
              id: groupId,
              yearName,
              sectionName,
              department,
              strength: 40,
              status: "Active",
              createdAt
            });
          }
        }
      }

      data.rooms = [
        { id: 1, roomNumber: "A-101", roomType: "Classroom", roomSpecialization: "General Classroom", capacity: 80, buildingName: "Academic Block A", status: "Available", createdAt },
        { id: 2, roomNumber: "A-102", roomType: "Classroom", roomSpecialization: "General Classroom", capacity: 80, buildingName: "Academic Block A", status: "Available", createdAt },
        { id: 3, roomNumber: "B-201", roomType: "Classroom", roomSpecialization: "General Classroom", capacity: 80, buildingName: "Academic Block B", status: "Available", createdAt },
        { id: 4, roomNumber: "C-LAB-1", roomType: "Lab", roomSpecialization: "Computer Lab", capacity: 45, buildingName: "Computing Block", status: "Available", createdAt },
        { id: 5, roomNumber: "C-LAB-2", roomType: "Lab", roomSpecialization: "Computer Lab", capacity: 45, buildingName: "Computing Block", status: "Available", createdAt },
        { id: 6, roomNumber: "E-LAB-1", roomType: "Lab", roomSpecialization: "Electronics Lab", capacity: 40, buildingName: "Electronics Block", status: "Available", createdAt }
      ];

      const facultyTemplates = makeFacultyTemplates();
      data.facultyRecords = facultyTemplates.map((record, index) => ({
        id: index + 1,
        ...record,
        createdAt
      }));
      for (const facultyRecord of data.facultyRecords) {
        syncFacultyToUser(data, facultyRecord);
      }

      const courseTemplates = makeCourseTemplates();
      data.courses = courseTemplates.map((course, index) => ({
        id: index + 1,
        code: course.code,
        name: course.name,
        department: course.department,
        credits: course.credits,
        semester: course.semester,
        maxSeats: course.maxSeats,
        facultyId: null,
        description: course.description,
        isOpen: true,
        createdAt,
        updatedAt: createdAt
      }));

      data.courseDepartmentMappings = data.courses.map((course, index) => ({
        id: index + 1,
        courseCode: course.code,
        department: course.department,
        createdAt
      }));

      const departmentFaculty = new Map();
      for (const department of departments) {
        departmentFaculty.set(department, data.facultyRecords.filter((item) => item.department === department));
      }
      const departmentCourses = new Map();
      for (const department of departments) {
        departmentCourses.set(department, data.courses.filter((item) => item.department === department));
      }

      let facultyCourseMappingId = 0;
      for (const department of departments) {
        const facultyInDept = departmentFaculty.get(department);
        const coursesInDept = departmentCourses.get(department);
        for (let i = 0; i < facultyInDept.length; i += 1) {
          const faculty = facultyInDept[i];
          const expertise = [
            coursesInDept[i % coursesInDept.length],
            coursesInDept[(i + 1) % coursesInDept.length],
            coursesInDept[(i + 2) % coursesInDept.length]
          ];
          for (const course of expertise) {
            facultyCourseMappingId += 1;
            data.facultyCourseMappings.push({
              id: facultyCourseMappingId,
              facultyId: faculty.id,
              courseCode: course.code,
              createdAt
            });
          }
        }
      }

      const deptCodeMap = {
        "Computer Science": "CSE",
        "AI and DS": "AID",
        "Electronics and Communication": "ECE"
      };
      let studentId = 0;
      data.studentRecords = [];
      for (const group of data.groups) {
        const code = deptCodeMap[group.department] || "GEN";
        for (let index = 1; index <= 30; index += 1) {
          studentId += 1;
          const rollNumber = `${code}${String(group.id).padStart(2, "0")}S${String(index).padStart(2, "0")}`;
          const record = {
            id: studentId,
            rollNumber,
            studentName: `${group.department.split(" ")[0]} Student ${String(index).padStart(2, "0")} - ${group.sectionName}`,
            studentPassword: "student123",
            groupId: group.id,
            yearName: group.yearName,
            sectionName: group.sectionName,
            status: "Active",
            email: `${rollNumber.toLowerCase()}@students.amrita.edu`,
            department: group.department,
            createdAt
          };
          data.studentRecords.push(record);
          syncStudentToUser(data, record);
        }
      }

      let adminCourseId = 0;
      let assignmentId = 0;
      for (const group of data.groups) {
        const coursesInDept = departmentCourses.get(group.department);
        const facultyInDept = departmentFaculty.get(group.department);
        for (let i = 0; i < coursesInDept.length; i += 1) {
          const course = coursesInDept[i];
          const matchingFaculty = facultyInDept.find((faculty) =>
            data.facultyCourseMappings.some(
              (mapping) => mapping.facultyId === faculty.id && mapping.courseCode === course.code
            )
          ) || facultyInDept[i % facultyInDept.length];
          adminCourseId += 1;
          data.adminCourses.push({
            id: adminCourseId,
            courseCode: course.code,
            courseName: course.name,
            credits: course.credits,
            academicYear: group.yearName,
            department: group.department,
            courseType: i % 2 === 0 ? "Theory + Lab" : "Theory",
            theoryHoursPerWeek: i % 2 === 0 ? 3 : 4,
            labHoursPerWeek: i % 2 === 0 ? 2 : 0,
            requiredRoomSpecialization: i % 2 === 0 ? "Computer Lab" : "General Classroom",
            groupName: groupLabel(group),
            status: "Active",
            createdAt
          });
          assignmentId += 1;
          data.courseAssignments.push({
            id: assignmentId,
            facultyId: matchingFaculty.id,
            courseId: adminCourseId,
            createdAt
          });
        }
      }

      let registrationId = 0;
      const studentUserByRoll = new Map(
        data.users
          .filter((item) => item.role === "student" && item.rollNumber)
          .map((item) => [item.rollNumber, item])
      );
      for (const student of data.studentRecords) {
        const studentUser = studentUserByRoll.get(student.rollNumber);
        if (!studentUser) continue;
        const deptCourses = departmentCourses.get(student.department) || [];
        for (const course of deptCourses.slice(0, 3)) {
          registrationId += 1;
          data.registrations.push({
            id: registrationId,
            courseId: course.id,
            studentId: studentUser.id,
            status: "registered",
            registeredAt: createdAt
          });
        }
      }

      return {
        departments: data.departments.length,
        groups: data.groups.length,
        facultyRecords: data.facultyRecords.length,
        students: data.studentRecords.length,
        courses: data.courses.length,
        teachingPlanRows: data.adminCourses.length
      };
    });

    console.log("Dummy data seeded successfully.");
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }).catch((error) => {
    console.error("Failed to seed dummy data:", error.message);
    process.exit(1);
  });
}

main();
