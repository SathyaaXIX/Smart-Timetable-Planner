function validateRequired(body, fields) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === "") {
      return `${field} is required`;
    }
  }
  return null;
}

module.exports = { validateRequired };
