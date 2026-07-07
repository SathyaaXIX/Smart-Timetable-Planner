import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const db = require('../backend/models/database');

(async () => {
  await db.initDatabase();
  const result = await db.transact((data) => {
    const norm = (v) => String(v || '').trim().toUpperCase();
    const byCode = new Map((data.courses || []).map((c) => [norm(c.code), c]));
    const merges = [];

    for (const m of (data.courses || [])) {
      const mCode = norm(m.code);
      if (!mCode.endsWith('M')) continue;
      const base = byCode.get(mCode.slice(0, -1));
      if (!base) continue;
      // Merge by code pair (X + XM). Names may differ slightly in punctuation/casing.

      const fromId = Number(m.id);
      const toId = Number(base.id);
      const fromCode = norm(m.code);

      for (const reg of (data.registrations || [])) {
        if (Number(reg.courseId) === fromId) reg.courseId = toId;
      }
      for (const slot of (data.timetable || [])) {
        if (Number(slot.courseId) === fromId) slot.courseId = toId;
      }
      for (const row of (data.attendanceRecords || [])) {
        if (Number(row.courseId) === fromId) row.courseId = toId;
      }
      for (const item of (data.adminCourses || [])) {
        if (norm(item.courseCode) === fromCode) item.courseCode = base.code;
      }
      for (const item of (data.facultyCourseMappings || [])) {
        if (norm(item.courseCode) === fromCode) item.courseCode = base.code;
      }
      for (const item of (data.courseDepartmentMappings || [])) {
        if (norm(item.courseCode) === fromCode) item.courseCode = base.code;
      }

      base.program = 'M.Tech';
      if (!String(base.academicYear || '').trim()) base.academicYear = String(m.academicYear || '1st Year');
      if (!String(base.semester || '').trim()) base.semester = String(m.semester || '');
      if (!String(base.department || '').trim()) base.department = String(m.department || '');
      if (String(m.description || '').trim() && !String(base.description || '').trim()) base.description = m.description;
      base.updatedAt = db.now();

      data.courses = data.courses.filter((c) => Number(c.id) !== fromId);
      merges.push({ fromId, fromCode: m.code, toId, toCode: base.code, name: base.name });
    }

    const dedupeBy = (arr, keyFn) => {
      const seen = new Set();
      return arr.filter((item) => {
        const key = keyFn(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    data.registrations = dedupeBy(data.registrations || [], (r) => `${Number(r.studentId)}|${Number(r.courseId)}|${String(r.status || '')}`);
    data.courseDepartmentMappings = dedupeBy(data.courseDepartmentMappings || [], (r) => `${norm(r.courseCode)}|${norm(r.department)}`);
    data.facultyCourseMappings = dedupeBy(data.facultyCourseMappings || [], (r) => `${Number(r.facultyId)}|${norm(r.courseCode)}`);

    return { merged: merges.length, merges };
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
