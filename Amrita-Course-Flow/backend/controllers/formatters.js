function courseResponse(data, course) {
  const enrolledCount = data.registrations.filter(
    (reg) => reg.courseId === course.id && reg.status === "registered"
  ).length;

  return {
    id: course.id,
    code: course.code,
    name: course.name,
    department: course.department,
    program: course.program || "B.Tech",
    academicYear: course.academicYear || "",
    credits: course.credits,
    semester: course.semester,
    maxSeats: course.maxSeats,
    facultyId: null,
    enrolledCount,
    facultyName: null,
    description: course.description || null,
    isOpen: Boolean(course.isOpen)
  };
}

function registrationResponse(data, reg) {
  const course = data.courses.find((item) => item.id === reg.courseId);
  const student = data.users.find((item) => item.id === reg.studentId);
  return {
    id: reg.id,
    courseId: reg.courseId,
    courseCode: course ? course.code : "",
    courseName: course ? course.name : "",
    studentId: reg.studentId,
    studentName: student ? student.name : "",
    registeredAt: reg.registeredAt,
    status: reg.status
  };
}

module.exports = { courseResponse, registrationResponse };
